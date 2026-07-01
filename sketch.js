// ══════════════════════════════════════════════════════
//  CONFIGURACIÓN DE AUDIO
// ══════════════════════════════════════════════════════

// --- Amplitud ---
let AMP_MIN = 0.001;
let AMP_MAX = 0.13;

// --- Pitch ---
let NOTA_MIN = 48;
let NOTA_MAX = 60;

// --- Calibración ---
let calibrandoAmp = true;
let pisoAmp = Infinity;
let techoAmp = -Infinity;

// --- Umbrales de comportamiento ---
// Separador grave/agudo en escala MIDI (do4=60, la3=57, fa3=53)
const NOTA_CORTE_GRAVE_AGUDO = 54;

// Intensidad mínima para considerar que "hay sonido"
const UMBRAL_RUIDO = 0.10;

// Duración mínima para considerar un sonido "largo" (ms)
const UMBRAL_DURACION_LARGA = 800;

// Umbral de intensidad para velRapida vs velLenta (escala 0-1 normalizada)
const UMBRAL_INTENSIDAD_ALTA = 0.80;

// --- Detección de doble palmada → reinicio ---
// Lógica: detectar dos golpes cortos separados por un silencio breve.
// Un "golpe" es: onset brusco (amp cruda alta) + duración corta + sin pitch.
// No usa FFT, solo amplitud y temporización → más robusto y sin falsos positivos tonales.
const UMBRAL_PALMADA_AMP = 0.04;  // amplitud cruda mínima para contar como golpe
const DUR_MAX_PALMADA_MS = 300;   // duración máxima de cada golpe (ms); si es más largo, no cuenta
const VENTANA_DOBLE_MS   = 800;   // tiempo máximo entre fin del golpe1 e inicio del golpe2 (ms)

// Cooldowns en ms para evitar disparos repetidos
const COOLDOWN_OLEADA_MS   = 2200; // se sube para frenar el crecimiento de densidad
const COOLDOWN_REINICIO_MS = 2000;
const COOLDOWN_CAOS_MS     = 1000;

// --- Estado de audio ---
let mic;
let audioIniciado = false;

// --- Estado de doble palmada ---
// Máquina de estados: 'espera' → 'golpe1_ok' → (reinicio o vuelve a 'espera')
let estadoPalmada    = 'espera';  // 'espera' | 'golpe1_ok'
let tFinGolpe1       = 0;         // millis() cuando terminó el primer golpe
let ampMaxGolpeActual = 0;        // pico de amp durante el golpe actual

// --- Gestores ---
let gestorAmp;
let gestorFrec;

// --- Señales derivadas ---
let amp        = 0;
let intensidad = 0;
let altura     = 0;

// --- Pitch ---
let frec      = 0;
let notaMidi  = 0;
let hayPitch  = false;
let pitch;
const MODEL_URL =
  "https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/";
let marcaUltimoPitch  = 0;
const TIMEOUT_SIN_PITCH = 300;

// --- Eventos de sonido ---
let haySonido          = false;
let antesHabiaSonido   = false;
let empezoElSonido     = false;
let terminoElSonido    = false;

let marcaInicioSonido  = 0;
let marcaFinSonido     = 0;
let durSonido          = 0;
let durSilencio        = 0;
let sonidoLargo        = false;

// --- Cooldowns (marca de tiempo del último disparo) ---
let tUltimaOleada   = -Infinity;
let tUltimoReinicio = -Infinity;
let tUltimoCaos     = -Infinity;

// ══════════════════════════════════════════════════════
//  CONFIGURACIÓN DEL SKETCH
// ══════════════════════════════════════════════════════

let nuclei  = [];
let walkers = [];

const COLS         = 7;
const ROWS         = 5;
const MIN_NUCLEI   = 20;
const PROB_NUCLEO  = 0.75;
const MIN_COLUMNAS = 4; // mínimo de columnas de goteo activas

let modoCaos = false;

// --- Presets de densidad ---
// Cada reinicio (doble aplauso) elige uno al azar. Controlan cuántas líneas
// nacen de cada núcleo al inicio, el rango de velocidad y cuántas oleadas
// extra se permiten antes de tener que esperar a que mueran los caminantes.
const PRESETS_DENSIDAD = [
  { nombre: 'vacio',      lineasPorNucleo: 2, velLenta: 0.15, velRapida: 2.2, maxOleadas: 2 },
  { nombre: 'intermedio', lineasPorNucleo: 3, velLenta: 0.22, velRapida: 2.8, maxOleadas: 3 },
  { nombre: 'lleno',      lineasPorNucleo: 4, velLenta: 0.30, velRapida: 3.4, maxOleadas: 4 },
];
let presetActual = PRESETS_DENSIDAD[1];

let VEL_RAPIDA  = presetActual.velRapida;
let VEL_LENTA   = presetActual.velLenta;
let MAX_OLEADAS = presetActual.maxOleadas;

// Velocidad "rampa": en vez de saltar de golpe entre lenta y rápida,
// se desliza suavemente cuadro a cuadro hacia el valor objetivo.
let velBoostActual = 1;

let numOleadas = 0;

// Tope duro de oleadas EXTRA (más allá de la inicial). La oleada inicial
// cuenta aparte, así que el total de oleadas nunca supera 1 + este valor,
// sin importar lo que diga el preset de densidad.
const MAX_OLEADAS_EXTRA = 3;

// Opacidad por número de oleada (0 = inicial, 1..3 = extra). La inicial
// se dibuja al 100% y cada oleada extra baja de opacidad para que se note
// que se van sumando sobre la trama base.
const OPACIDADES_OLEADA = [1.0, 0.75, 0.60, 0.50];

function opacidadParaOleada(indiceOleada) {
  let i = constrain(indiceOleada, 0, OPACIDADES_OLEADA.length - 1);
  return OPACIDADES_OLEADA[i];
}


// ══════════════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════════════

function setup() {
  createCanvas(700, 500);

  mic = new p5.AudioIn();

  gestorAmp  = new GestorSenial(AMP_MIN, AMP_MAX);
  gestorFrec = new GestorSenial(NOTA_MIN, NOTA_MAX);

  makeNuclei();
  
  background('#f5f2e8');
  //init();
}

// ══════════════════════════════════════════════════════
//  DRAW
// ══════════════════════════════════════════════════════

function draw() {
  if (!audioIniciado) {
    return;
  }

  let velBoost = 1;

  if (audioIniciado) {
    // ── Leer señales ──────────────────────────────────
    amp = mic.getLevel();
    

    if (calibrandoAmp) {
      pisoAmp  = min(pisoAmp, amp);
      techoAmp = max(techoAmp, amp);
    }

    gestorAmp.actualizar(amp);
    intensidad = gestorAmp.filtrada;   // 0..1 normalizado y suavizado
    altura     = gestorFrec.filtrada;  // 0..1 normalizado y suavizado

    // ── Eventos de sonido ─────────────────────────────
    haySonido       = intensidad > UMBRAL_RUIDO;
    empezoElSonido  = haySonido && !antesHabiaSonido;
    terminoElSonido = !haySonido && antesHabiaSonido;

    if (empezoElSonido) {
      marcaInicioSonido  = millis();
      durSilencio        = millis() - marcaFinSonido;
      sonidoLargo        = false;
      ampMaxGolpeActual  = amp;  // empezar a trackear pico del golpe actual
    }

    if (haySonido) {
      durSonido = millis() - marcaInicioSonido;
      sonidoLargo = durSonido >= UMBRAL_DURACION_LARGA;
      ampMaxGolpeActual = max(ampMaxGolpeActual, amp);  // acumular pico
    }

    if (terminoElSonido) {
      durSonido      = millis() - marcaInicioSonido;
      marcaFinSonido = millis();

      // ── MÁQUINA DE DOBLE PALMADA ──────────────────
      // Un golpe válido es: corto + amp alta + sin pitch
      //let esGolpeValido = durSonido < DUR_MAX_PALMADA_MS
                       //&& ampMaxGolpeActual > UMBRAL_PALMADA_AMP
                       //&& !hayPitch;

       let esGolpeValido = durSonido < DUR_MAX_PALMADA_MS && ampMaxGolpeActual > UMBRAL_PALMADA_AMP;

      if (estadoPalmada === 'espera') {
        if (esGolpeValido) {
          // Primer golpe detectado: esperar el segundo
          estadoPalmada = 'golpe1_ok';
          tFinGolpe1    = millis();
          console.log('>>> PALMADA 1 detectada, esperando segunda...');
        }
      } else if (estadoPalmada === 'golpe1_ok') {
        let dentroDeVentana = millis() - tFinGolpe1 < VENTANA_DOBLE_MS;
        if (esGolpeValido && dentroDeVentana
            && millis() - tUltimoReinicio > COOLDOWN_REINICIO_MS) {
          // Segundo golpe dentro de la ventana → reinicio
          console.log('>>> DOBLE PALMADA → reinicio');
          tUltimoReinicio = millis();
          estadoPalmada   = 'espera';
          makeNuclei();
          init();
        } else {
          // Golpe inválido o fuera de ventana → resetear
          estadoPalmada = esGolpeValido ? 'golpe1_ok' : 'espera';
          if (esGolpeValido) {
            tFinGolpe1 = millis();  // este golpe pasa a ser el nuevo "primero"
            console.log('>>> Ventana expiró, nueva palmada 1');
          }
        }
      }

      ampMaxGolpeActual = 0;  // resetear pico para el próximo golpe

      // ── SONIDO CORTO TONAL: oleada o caos según altura ──
      if (!sonidoLargo && hayPitch) {
        let esAgudo = notaMidi > NOTA_CORTE_GRAVE_AGUDO;

        console.log("Detectado: Nota MIDI " + Math.round(notaMidi) + " | ¿Es agudo?: " + esAgudo);

        if (esAgudo && millis() - tUltimaOleada > COOLDOWN_OLEADA_MS) {
          if (numOleadas < MAX_OLEADAS) {
            console.log('>>> SONIDO CORTO AGUDO → oleada (' + (numOleadas + 1) + '/' + MAX_OLEADAS + ')');
            tUltimaOleada = millis();
            // Oleada extra: menos líneas que la oleada inicial para no
            // disparar la densidad de golpe.
            spawnOleada(Math.max(1, Math.round(presetActual.lineasPorNucleo * 0.6)));
            loop();
          }
        } else if (!esAgudo && millis() - tUltimoCaos > COOLDOWN_CAOS_MS) {
          console.log('>>> SONIDO CORTO GRAVE → toggle caos');
          tUltimoCaos = millis();
          modoCaos = !modoCaos;
          // Al activar el modo caos se permite una pequeña oleada extra,
          // para que el usuario pueda "llenar" un preset vacío interactuando.
          if (modoCaos && numOleadas < MAX_OLEADAS
              && millis() - tUltimaOleada > COOLDOWN_OLEADA_MS) {
            tUltimaOleada = millis();
            spawnOleada(Math.max(1, Math.round(presetActual.lineasPorNucleo * 0.5)));
          }
        }
      }

      sonidoLargo = false;
    }

    // Expiración de ventana de doble palmada (sin segundo golpe)
    if (estadoPalmada === 'golpe1_ok'
        && millis() - tFinGolpe1 > VENTANA_DOBLE_MS) {
      estadoPalmada = 'espera';
      console.log('>>> Ventana de doble palmada expiró');
    }

    if (!haySonido) {
      durSilencio = millis() - marcaFinSonido;
    }

    // ── SONIDO LARGO: velocidad progresiva y en rampa ─
    // En vez de un salto binario lento/rápido, el objetivo de velocidad
    // es una progresión continua según la intensidad, y luego se desliza
    // suavemente cuadro a cuadro hacia ese objetivo (sin saltos bruscos).
    let velBoostObjetivo = 1;
    if (haySonido && sonidoLargo) {
      velBoostObjetivo = map(intensidad, UMBRAL_RUIDO, 1.0, VEL_LENTA, VEL_RAPIDA, true);
    }
    velBoostActual = lerp(velBoostActual, velBoostObjetivo, 0.06);
    velBoost = velBoostActual;

    antesHabiaSonido = haySonido;

  }

  // ── Teclas de velocidad (siempre activas) ─────────
  if (keyIsDown(86))      velBoost = VEL_RAPIDA;  // V
  else if (keyIsDown(76)) velBoost = VEL_LENTA;   // L

  // ── Actualizar y dibujar walkers ──────────────────
  let all = true;
  for (let w of walkers) {
    if (!w.dead) {
      w.actualizar(velBoost);
      w.dibujar();
      all = false;
    }
  }
  if (all) {
    noLoop();
    escucharEnPausa();
  }

  
}

// ══════════════════════════════════════════════════════
//  ESCUCHA EN PAUSA
//  Cuando todos los walkers murieron, draw() se detiene.
//  Este intervalo sigue procesando audio para detectar
//  doble palmada (reinicio) y oleada.
// ══════════════════════════════════════════════════════

let intervaloEnPausa = null;

function escucharEnPausa() {
  if (intervaloEnPausa !== null) return;  // ya está corriendo

  intervaloEnPausa = setInterval(() => {
    if (!audioIniciado) return;

    amp = mic.getLevel();
    gestorAmp.actualizar(amp);
    intensidad = gestorAmp.filtrada;

    haySonido       = intensidad > UMBRAL_RUIDO;
    empezoElSonido  = haySonido && !antesHabiaSonido;
    terminoElSonido = !haySonido && antesHabiaSonido;

    if (empezoElSonido) {
      marcaInicioSonido = Date.now();
      durSilencio       = Date.now() - marcaFinSonido;
      sonidoLargo       = false;
      ampMaxGolpeActual = amp;
    }

    if (haySonido) {
      durSonido         = Date.now() - marcaInicioSonido;
      sonidoLargo       = durSonido >= UMBRAL_DURACION_LARGA;
      ampMaxGolpeActual = Math.max(ampMaxGolpeActual, amp);
    }

    if (terminoElSonido) {
      durSonido      = Date.now() - marcaInicioSonido;
      marcaFinSonido = Date.now();

      // Doble palmada → reinicio
      /*let esGolpeValido = durSonido < DUR_MAX_PALMADA_MS
                       && ampMaxGolpeActual > UMBRAL_PALMADA_AMP
                       && !hayPitch;*/
      
     let esGolpeValido = durSonido < DUR_MAX_PALMADA_MS && ampMaxGolpeActual > UMBRAL_PALMADA_AMP;                

      if (estadoPalmada === 'espera') {
        if (esGolpeValido) {
          estadoPalmada = 'golpe1_ok';
          tFinGolpe1    = Date.now();
          console.log('>>> PALMADA 1 (pausa), esperando segunda...');
        }
      } else if (estadoPalmada === 'golpe1_ok') {
        let dentroDeVentana = Date.now() - tFinGolpe1 < VENTANA_DOBLE_MS;
        if (esGolpeValido && dentroDeVentana
            && Date.now() - tUltimoReinicio > COOLDOWN_REINICIO_MS) {
          console.log('>>> DOBLE PALMADA (pausa) → reinicio');
          tUltimoReinicio = Date.now();
          estadoPalmada   = 'espera';
          detenerEscuchaEnPausa();
          makeNuclei();
          init();  // init llama loop() internamente
        } else {
          estadoPalmada = esGolpeValido ? 'golpe1_ok' : 'espera';
          if (esGolpeValido) tFinGolpe1 = Date.now();
        }
      }

      // Sonido corto agudo → oleada
      if (!sonidoLargo && hayPitch) {
        let esAgudo = notaMidi > NOTA_CORTE_GRAVE_AGUDO;
        if (esAgudo && numOleadas < MAX_OLEADAS
            && Date.now() - tUltimaOleada > COOLDOWN_OLEADA_MS) {
          console.log('>>> SONIDO CORTO AGUDO (pausa) → oleada');
          tUltimaOleada = Date.now();
          detenerEscuchaEnPausa();
          spawnOleada(Math.max(1, Math.round(presetActual.lineasPorNucleo * 0.6)));
          loop();
        }
      }

      ampMaxGolpeActual = 0;
    }

    // Expiración ventana palmada
    if (estadoPalmada === 'golpe1_ok'
        && Date.now() - tFinGolpe1 > VENTANA_DOBLE_MS) {
      estadoPalmada = 'espera';
    }

    antesHabiaSonido = haySonido;
  }, 16);  // ~60fps
}

function detenerEscuchaEnPausa() {
  if (intervaloEnPausa !== null) {
    clearInterval(intervaloEnPausa);
    intervaloEnPausa = null;
  }
}

// ══════════════════════════════════════════════════════
//  INICIO DE AUDIO
// ══════════════════════════════════════════════════════

async function iniciarAudio() {
  if (audioIniciado) return;

  try {
    await userStartAudio();
    mic.start(
      () => {
        audioIniciado     = true;
        marcaInicioSonido = millis();
        marcaFinSonido    = millis();
        marcaUltimoPitch  = millis();
        init();
        startPitch();
        console.log('Audio activado');
      },
      (error) => {
        console.error('No se pudo iniciar el micrófono', error);
      }
    );
  } catch (error) {
    console.error('No se pudo habilitar el contexto de audio', error);
  }
}

function mousePressed() {
  iniciarAudio();
}

function touchStarted() {
  iniciarAudio();
  return false;
}

// ══════════════════════════════════════════════════════
//  DETECCIÓN DE PITCH (ml5 CREPE)
// ══════════════════════════════════════════════════════

function startPitch() {
  pitch = ml5.pitchDetection(
    MODEL_URL,
    getAudioContext(),
    mic.stream,
    modelLoaded
  );
}

function modelLoaded() {
  getPitch();
}

function getPitch() {
  pitch.getPitch(function (err, frequency) {
    if (err) {
      console.error('Error en getPitch:', err);
      setTimeout(getPitch, 120);
      return;
    }

    if (frequency) {
      frec     = frequency;
      notaMidi = freqToMidi(frequency);
      hayPitch = true;
      marcaUltimoPitch = millis();
      gestorFrec.actualizar(notaMidi);
    } else {
      frec     = 0;
      hayPitch = millis() - marcaUltimoPitch <= TIMEOUT_SIN_PITCH;
    }

    getPitch();
  });
}

// ══════════════════════════════════════════════════════
//  TECLADO
// ══════════════════════════════════════════════════════

function keyPressed() {
  if (key === 'r' || key === 'R') { makeNuclei(); init(); }
  if (key === 'o' || key === 'O') { spawnOleada(); loop(); }
  if (key === 'c' || key === 'C') { modoCaos = !modoCaos; }

  if (key === 'a' || key === 'A') {
    calibrandoAmp = !calibrandoAmp;
    console.log('AMP_MIN =', pisoAmp, '| AMP_MAX =', techoAmp);
    if (!calibrandoAmp && isFinite(pisoAmp) && isFinite(techoAmp) && techoAmp > pisoAmp) {
      gestorAmp.minimo = pisoAmp;
      gestorAmp.maximo = techoAmp;
      console.log('Rango aplicado a gestorAmp:', gestorAmp.minimo, gestorAmp.maximo);
    }
  }
}

// ══════════════════════════════════════════════════════
//  FUNCIONES DEL SKETCH
// ══════════════════════════════════════════════════════

function makeNuclei() {
  // Grilla base de COLS x ROWS (7x5), como al principio. Cada columna
  // sigue funcionando como una cadena de goteo: la fila de arriba queda
  // más apretada y con poca deriva lateral, y la de abajo se "afloja"
  // más — pero las posiciones de partida son una grilla prolija.
  nuclei = [];
  let colActivas = 0;

  for (let c = 0; c < COLS; c++) {
    let esActiva = random(1) < PROB_NUCLEO || (COLS - c) <= (Math.max(3, MIN_COLUMNAS) - colActivas);
    if (!esActiva) continue;
    colActivas++;

    let colX = (c + 1) * width / (COLS + 1) + random(-18, 18);
    let yInicio = height * random(0.05, 0.14);
    let yFin    = height * random(0.82, 0.97);

    for (let r = 0; r < ROWS; r++) {
      // filas parejas: grilla real, sin amontonar puntos arriba
      let t = ROWS > 1 ? r / (ROWS - 1) : 0;
      let y = lerp(yInicio, yFin, t);
      // la deriva lateral crece con t: la columna se afloja al caer,
      // pero cada fila arranca de una posición de grilla prolija
      let derivaX = random(-1, 1) * lerp(6, 34, t);
      nuclei.push({ x: colX + derivaX, y: y, columna: c });
    }
  }

  // Fallback de seguridad si quedó muy vacío: grilla fija, prolija
  if (nuclei.length < MIN_NUCLEI) {
    nuclei = [];
    for (let c = 0; c < COLS; c++) {
      let colX = (c + 1) * width / (COLS + 1);
      for (let r = 0; r < ROWS; r++) {
        let y = height * ((r + 1) / (ROWS + 1));
        nuclei.push({ x: colX, y: y, columna: c });
      }
    }
  }
}

function init() {
  detenerEscuchaEnPausa();

  // Elegir preset de densidad al azar en cada reinicio.
  presetActual   = random(PRESETS_DENSIDAD);
  VEL_LENTA      = presetActual.velLenta;
  VEL_RAPIDA     = presetActual.velRapida;
  // Nunca más de 1 (inicial) + MAX_OLEADAS_EXTRA oleadas en total,
  // sin importar lo que indique el preset de densidad elegido.
  MAX_OLEADAS    = min(presetActual.maxOleadas, 1 + MAX_OLEADAS_EXTRA);
  velBoostActual = 1;
  console.log('>>> Preset de densidad: ' + presetActual.nombre +
              ' (líneas/núcleo=' + presetActual.lineasPorNucleo +
              ', velLenta=' + VEL_LENTA + ', velRapida=' + VEL_RAPIDA +
              ', maxOleadas=' + MAX_OLEADAS + ')');

  background('#f5f2e8');
  walkers    = [];
  numOleadas = 0;
  spawnOleada();
  loop();
}

function spawnOleada(cantidad) {
  // Si no se especifica, usa la cantidad de líneas por núcleo del preset
  // activo. Las oleadas "extra" (sonido agudo, o modo caos) piden una
  // cantidad menor para no disparar la densidad de golpe.
  let n_ = cantidad !== undefined ? cantidad : presetActual.lineasPorNucleo;

  // numOleadas todavía no se incrementó: 0 = esta es la oleada inicial,
  // 1/2/3 = primera/segunda/tercera oleada extra.
  let opacidad = opacidadParaOleada(numOleadas);

  for (let n of nuclei) {
    for (let i = 0; i < n_; i++) {
      // Arco de 180° hacia arriba (la trama sube desde el núcleo), de
      // horizontal-izquierda a horizontal-derecha, pasando por arriba
      // (-HALF_PI).
      let t = n_ > 1 ? i / (n_ - 1) : 0.5;
      let dir = -HALF_PI + lerp(-HALF_PI, HALF_PI, t) + random(-0.12, 0.12);
      walkers.push(new Caminante(n.x, n.y, dir, n.columna, opacidad));
    }
  }
  numOleadas++;
}