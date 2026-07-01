class Caminante {

    constructor(nx, ny, dir, columna, opacidadOleada) {
        this.x = nx + random(-3, 3);
        this.y = ny + random(-3, 3);
        this.dir = dir;
        this.velBase = 1.2 + random(1.2);

        // Opacidad global asignada por la oleada a la que pertenece este
        // caminante (1 = oleada inicial, va bajando en oleadas extra).
        this.opacidadOleada = opacidadOleada === undefined ? 1 : opacidadOleada;

        this.vida = 600;
        this.recorrido = 0;
        this.dead = false;

        this.estado = 'recta';
        this.anguloGiro = radians(random(3, 8)) * (random(1) < 0.5 ? 1 : -1);
        this.cuenta = int(random(8, 35));

        this.noiseOffset = random(1000);

        this.px = this.x;
        this.py = this.y;

        this.esGrueso = random(1) < 0.25;

        // columna de origen: mantiene al caminante ligado a su cadena vertical
        this.columna = columna;

        // peso del goteo: cuánto lo domina la gravedad con el tiempo (viscosidad de tinta)
        this.pesoGoteo = random(0.7, 1.5);

        // tinta acumulada por punto (para el encharcado en giros/pausas)
        this.tintaExtra = 0;
        this.nudo = 0; // contador de frames con encharcado activo

        this.targetNucleus = null;
        this.pickTarget();
    }

    pickTarget() {
        // Solo apunta a núcleos MÁS ARRIBA (menor y) en la misma columna:
        // así el caminante encadena la subida por su propia columna en vez
        // de irse a buscar núcleos lejanos o hacia abajo.
        let arribaMismaCol = nuclei.filter(n =>
            n.columna === this.columna && n.y < this.y - 15
        );
        let arribaVecina = nuclei.filter(n =>
            Math.abs(n.columna - this.columna) === 1 && n.y < this.y - 15
        );

        if (arribaMismaCol.length > 0 && random(1) < 0.85) {
            this.targetNucleus = random(arribaMismaCol);
        } else if (arribaVecina.length > 0 && random(1) < 0.3) {
            this.targetNucleus = random(arribaVecina);
        } else {
            // No queda nada más arriba: soltar el target y dejar que la
            // gravedad y el cono de subida terminen el recorrido.
            this.targetNucleus = null;
        }
    }

    lerpAngle(a, b, t) {
        let d = b - a;
        while (d > PI)  d -= TWO_PI;
        while (d < -PI) d += TWO_PI;
        return a + d * t;
    }

    actualizar(velBoost) {
        if (velBoost === undefined) velBoost = 1;
        this.px = this.x;
        this.py = this.y;

        let vel = this.velBase * velBoost;

        let noiseVal = noise(this.x * 0.003, this.y * 0.003, this.noiseOffset);
        let noisePush = map(noiseVal, 0, 1, -radians(2), radians(2));
        this.noiseOffset += 0.006;

        if (this.estado === 'recta') {
            this.cuenta--;
            if (this.cuenta <= 0) {
                // modoCaos: más quiebres abruptos y más angulares
                // fluido: más curvas suaves
                let probQuiebre = modoCaos ? 0.55 : 0.2;
                if (random(1) < probQuiebre) {
                    let rango = modoCaos ? random(50, 90) : random(35, 65);
                    let angBrusco = radians(rango) * (random(1) < 0.5 ? 1 : -1);
                    this.dir += angBrusco;
                    this.estado = 'recta';
                    this.cuenta = int(random(6, modoCaos ? 20 : 30));
                    this.nudo = 5; // encharcado breve de tinta en el quiebre
                } else {
                    this.estado = 'curva';
                    let maxAng = modoCaos ? 12 : 6;
                    this.anguloGiro = radians(random(2, maxAng)) * (random(1) < 0.5 ? 1 : -1);
                    this.cuenta = int(random(10, modoCaos ? 25 : 40));
                }
            }
        } else if (this.estado === 'curva') {
            this.dir += this.anguloGiro;
            this.anguloGiro += random(-radians(0.5), radians(0.5));
            let limAng = modoCaos ? 14 : 8;
            this.anguloGiro = constrain(this.anguloGiro, radians(-limAng), radians(limAng));
            this.cuenta--;
            if (this.cuenta <= 0) {
                this.estado = 'recta';
                this.cuenta = int(random(8, 35));
            }
        }

        this.dir += noisePush;

        // Temblor de pulso: micro-jitter de alta frecuencia que rompe la
        // suavidad perfecta de la curva, como el leve temblor de una mano
        // guiando tinta (visible en las 4 obras de referencia).
        this.dir += random(-radians(1.1), radians(1.1));

        // Gravedad progresiva: cuanto más "vive" el caminante, más lo domina
        // el impulso y más se dobla hacia arriba — sube y pierde tensión,
        // aflojando la trama a medida que se aleja de su origen.
        let vidaFrac = constrain(this.recorrido / this.vida, 0, 1);
        let gravedadFuerza = (0.02 + vidaFrac * vidaFrac * 0.08) * this.pesoGoteo;
        this.dir = this.lerpAngle(this.dir, -HALF_PI, gravedadFuerza);

        if (this.targetNucleus) {
            let angTarget = atan2(this.targetNucleus.y - this.y, this.targetNucleus.x - this.x);
            let distTarget = dist(this.x, this.y, this.targetNucleus.x, this.targetNucleus.y);
            let atrac = map(distTarget, 0, 400, 0.001, 0.025);
            this.dir = this.lerpAngle(this.dir, angTarget, atrac);
            if (distTarget < 35) this.pickTarget();
        }

        let fr = 55;
        if (this.x < fr)           this.dir = this.lerpAngle(this.dir, 0,        map(this.x, 0, fr, 0.2, 0));
        if (this.x > width - fr)   this.dir = this.lerpAngle(this.dir, PI,       map(this.x, width - fr, width, 0, 0.2));
        if (this.y > height - fr)  this.dir = this.lerpAngle(this.dir, -HALF_PI, map(this.y, height - fr, height, 0, 0.2));
        // (sin empuje cerca del borde superior: contradice la subida de
        // 180°. Al llegar arriba, el caminante muere.)

        // Cono de subida de 180°: la dirección nunca debe apuntar "hacia
        // abajo". Si por los quiebres/ruido se desvía fuera del semicírculo
        // superior (-PI a 0), se la empuja suavemente de vuelta al borde
        // más cercano de ese rango. Esto evita que el trazo se cierre en
        // loops y garantiza que todo suba, no que se enrosque.
        let dirNorm = this.dir;
        while (dirNorm > PI)  dirNorm -= TWO_PI;
        while (dirNorm < -PI) dirNorm += TWO_PI;
        if (dirNorm > 0) {
            let destino = (dirNorm > HALF_PI) ? PI : 0;
            // En modo caos los quiebres son más bruscos y frecuentes; se
            // refuerza la corrección para que igual respete la subida de
            // 180° y no se sienta "roto" respecto del modo normal.
            let correccion = modoCaos ? 0.24 : 0.15;
            this.dir = this.lerpAngle(this.dir, destino, correccion);
        }

        this.x += vel * cos(this.dir);
        this.y += vel * sin(this.dir);
        this.x = constrain(this.x, 2, width - 2);

        // Al tocar el TECHO del canvas, el caminante muere ahí mismo: ahora
        // que la trama sube en vez de caer, el techo es el borde que corta
        // la vida (evita el amontonamiento/línea horizontal arriba).
        if (this.y <= 2) {
            this.y = 2;
            this.dead = true;
        } else {
            this.y = min(this.y, height - 2);
        }

        let paso = dist(this.x, this.y, this.px, this.py);
        this.recorrido += paso;
        if (this.recorrido >= this.vida) this.dead = true;

        if (this.nudo > 0) this.nudo--;
    }

    dibujar() {
        let minDist = Infinity;
        for (let n of nuclei) {
            let d = dist(this.x, this.y, n.x, n.y);
            if (d < minDist) minDist = d;
        }

        let maxR = (width / (COLS + 1)) * 0.9;
        // Zona de "conciencia" del núcleo: en vez de engrosar y oscurecer
        // el trazo cerca del centro (lo que generaba manchones), el trazo
        // se afina y se vuelve más transparente a medida que se acerca —
        // como si el núcleo se autorregulara para no saturarse de tinta.
        let radioConciencia = maxR * 0.35;

        let sw, alpha;

        if (minDist < radioConciencia) {
            // t = 0 en el centro del núcleo, t = 1 en el borde de la zona
            let t = map(minDist, 0, radioConciencia, 0, 1, true);
            sw    = lerp(0.4, 2.0, t);
            alpha = lerp(50, 165, t);
        } else {
            sw    = map(minDist, radioConciencia, maxR, 2.0, 0.6, true);
            alpha = map(minDist, radioConciencia, maxR, 165, 120, true);
            if (this.esGrueso) sw *= 1.25; // el rasgo "grueso" solo se nota lejos del núcleo
        }

        // Textura de tinta: pulso irregular de grosor a lo largo del trazo,
        // como presión de mano variable — evita el grosor perfectamente
        // uniforme de una línea "digital".
        let inkNoise = noise(this.x * 0.06, this.y * 0.06, this.noiseOffset * 4);
        sw *= map(inkNoise, 0, 1, 0.55, 1.55, true);

        // Afinado por recorrido: el trazo nace más grueso (más tinta cargada
        // en el pincel/gota) y se va afinando a medida que el caminante
        // avanza en su vida, como un trazo de tinta que se va gastando.
        let vidaFrac = constrain(this.recorrido / this.vida, 0, 1);
        let grosorVida = map(vidaFrac, 0, 1, 2.0, 0.55, true);
        sw *= grosorVida;

        // Encharcado: en los quiebres bruscos la tinta se acumula un instante,
        // igual que un trazo real cuando la mano se detiene a cambiar de rumbo.
        if (this.nudo > 0) {
            sw += map(this.nudo, 5, 0, 2.5, 0);
        }

        // Opacidad de oleada: las oleadas extra (sonido agudo / caos) se
        // dibujan más tenues que la oleada inicial, para que se note que
        // son un agregado y no compitan visualmente con la trama base.
        alpha *= this.opacidadOleada;

        stroke(20, 18, 30, alpha);
        strokeWeight(sw);
        line(this.px, this.py, this.x, this.y);
    }
}