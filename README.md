# Pulso — tu WHOOP 4.0 sin suscripción

App de iPhone (SwiftUI, iOS 17+) que se conecta directamente por Bluetooth a una **WHOOP 4.0**, descarga
todos sus datos segundo a segundo y calcula en el propio teléfono recuperación, sueño, esfuerzo, VFC,
estrés y mucho más. Incluye planes de entrenamiento adaptativos, integración con **Strava**, **Strong**
y **Apple Salud**, y un **coach con IA** (Claude) que conoce todos tus datos.

> Investigación del dispositivo y del protocolo: [`docs/INVESTIGACION_WHOOP4.md`](docs/INVESTIGACION_WHOOP4.md)
>
> **¿Sin firmar apps?** Hay una versión web autoalojada (Docker + Tailscale + Bluefy) con informes semanales, Telegram y todo lo demás:
> [`server/README.md`](server/README.md). Instalación: `sudo bash server/install.sh`.

---

## Funciones

**Pulsera**
- Emparejado, sincronización automática en segundo plano (reconecta sola al acercarte), cada 15 min.
- Descarga del historial completo con confirmación por bloques (si algo falla, la pulsera lo reenvía).
- FC en directo, batería, carga, puesta/quitada, doble toque, número de serie y firmware.
- Hacer vibrar, despertador en la pulsera y **despertador inteligente** (te despierta en sueño ligero dentro de una ventana).
- FC por Bluetooth estándar: úsala como banda de pecho en Strava, Zwift, cintas o bicis.
- Diagnóstico: registro BLE en vivo y captura de tramas crudas exportable (por si un firmware nuevo cambia el formato).

**Métricas (todas en local)**
- **Recuperación** 0–100 % (VFC, FC en reposo, sueño, respiración y temperatura frente a tu línea base de 30 días).
- **Esfuerzo / strain** 0–21 (carga cardiovascular TRIMP sobre reserva de FC), con objetivo diario según recuperación y carga.
- **Sueño**: detección automática, siestas, fases estimadas (despierto/ligero/profundo/REM), hipnograma, eficiencia, latencia,
  despertares, ciclos REM, consistencia, **necesidad de sueño** (base + esfuerzo + deuda − siestas) y hora recomendada para acostarte.
- **VFC** (RMSSD, SDNN, pNN50), **FC en reposo**, **frecuencia respiratoria** (arritmia sinusal), temperatura de piel relativa,
  SpO₂ experimental.
- **Calorías** (Keytel + metabolismo basal), zonas de FC, actividades detectadas automáticamente.
- **Estrés** 0–3 a lo largo del día y respiración guiada con biofeedback de VFC.
- **Carga de entrenamiento**: ratio agudo:crónico, monotonía, estado (óptimo / sobrecarga / desentrenamiento).
- Tendencias 7/30/90/365 días, correlaciones (X hoy → Y mañana), hallazgos automáticos e informe semanal.

**Entreno**
- **Generador de planes periodizados** (fuerza, hipertrofia, pérdida de grasa, resistencia, híbrido, salud), 2–6 días,
  material disponible, músculos prioritarios, semanas de descarga y cargas sugeridas a partir de tus 1RM de Strong.
- O **plan generado por la IA** con todos tus datos.
- **La sesión de cada día se adapta a tu recuperación** (verde = plan, amarillo = −20 % volumen, rojo = regenerativa).
- Grabación de entrenos con FC en directo, esfuerzo y calorías en tiempo real.
- **Strong**: importación del CSV (también con «Abrir con… Pulso»), progresión de 1RM estimado, récords, series por músculo, volumen semanal.
- **Strava**: importación de actividades y **subida de entrenos con la curva de FC de la pulsera** (TCX), p. ej. tus sesiones de Strong.
- **Apple Salud**: lee pasos, peso y entrenos; escribe FC, FC en reposo, respiración y fases de sueño.

**Tú**
- Perfil y **medidas corporales** (peso, % grasa, cintura, pecho, cadera, cuello, brazo, muslo, gemelo) con gráficas,
  IMC, masa magra, FFMI y % de grasa estimado (método de la Marina de EE. UU.).
- **Diario de hábitos** (alcohol, cafeína, cena tarde, pantallas, estrés, meditación, sauna, frío…) con su impacto real en tu recuperación.
- **Coach IA**: chat con streaming que ve tus últimos 30 días, entrenos, plan, medidas y diario; **análisis automático de cada día**.
- Notificaciones de recuperación al despertar y recordatorio para acostarte.
- Exportación: CSV diario, copia JSON completa y muestras segundo a segundo.
- **Modo demo** con 3 semanas de datos realistas para probarlo todo antes de que llegue la pulsera.

---

## Instalar en tu iPhone

Necesitas tu **Apple ID gratuito**. Hay dos caminos:

### Opción A — con un Mac (la más sencilla)

1. Instala **Xcode 16** o superior (App Store) y [Homebrew](https://brew.sh).
2. En la carpeta del proyecto:
   ```bash
   brew install xcodegen
   xcodegen generate
   open Pulso.xcodeproj
   ```
3. En Xcode › proyecto **Pulso** › target **Pulso** › *Signing & Capabilities*:
   - *Team*: añade tu Apple ID (Xcode › Settings › Accounts) y elige tu «Personal Team».
   - *Bundle Identifier*: cámbialo a algo único, p. ej. `com.tunombre.pulso`.
4. Conecta el iPhone por cable, actívale el **Modo desarrollador** (Ajustes › Privacidad y seguridad › Modo desarrollador)
   y pulsa ▶︎ *Run*.
5. La primera vez: en el iPhone, Ajustes › General › VPN y gestión de dispositivos › confía en tu Apple ID.

Con cuenta gratuita la app **caduca a los 7 días**: vuelve a darle a ▶︎ en Xcode (tus datos se conservan).
Con la cuenta de desarrollador de pago (99 €/año) dura un año y se puede usar TestFlight.

> Si Xcode se queja de la capacidad HealthKit con tu cuenta, borra las dos líneas `com.apple.developer.healthkit…`
> de `project.yml` y vuelve a ejecutar `xcodegen generate`. Todo funciona igual salvo Apple Salud.

### Opción B — sin Mac (GitHub + SideStore/AltStore/Sideloadly)

1. Sube esta carpeta a un repositorio de GitHub (público = minutos de Mac gratis).
2. La acción **Compilar Pulso** (`.github/workflows/build.yml`) pasa los tests, compila y genera `Pulso.ipa`
   (pestaña *Actions* › última ejecución › *Artifacts*).
3. Instálalo con **SideStore** o **AltStore** (se re-firman solos cada 7 días) o con **Sideloadly** desde Windows/Mac.

---

## Primeros pasos

1. **Cierra/desinstala la app oficial de WHOOP**: la pulsera solo admite un enlace Bluetooth cifrado a la vez.
2. Abre Pulso → completa tu perfil → **Buscar pulsera** → elige tu WHOOP → acepta el emparejamiento de iOS.
3. Llévala puesta: Pulso descarga el historial cada 15 min (y al abrir la app). Por la mañana verás tu recuperación.
4. La recuperación se personaliza a partir del **4.º día** (antes usa una referencia general) y el ratio de carga a las 2 semanas.

> ⚠️ **No actualices el firmware con la app oficial** si todo funciona: un firmware nuevo puede cambiar el formato
> de los registros. Pulso trae un detector automático de formato y captura de tramas por si acaso.

### Strava
1. Entra en <https://www.strava.com/settings/api> y crea una app: nombre *Pulso*, web `http://localhost`,
   **Authorization Callback Domain** `localhost`.
2. En Pulso › Más › Integraciones pega el *Client ID* y el *Client Secret* → *Conectar con Strava*.

### Strong
Strong no tiene API. En Strong: *Perfil › Ajustes › Exportar datos de Strong* → en el menú compartir elige **Pulso**
(o guarda el archivo y usa *Importar CSV de Strong*). Repite cuando quieras: solo se añaden los entrenos nuevos.
Si en Strong activas Apple Salud, sus sesiones también entran por esa vía.

### Coach IA
Crea una clave en <https://console.anthropic.com> (API Keys) y pégala en Ajustes › Coach IA. Se guarda en el llavero
del iPhone y solo se envía a `api.anthropic.com`. Por defecto usa **Claude Opus 5.5**; puedes elegir Sonnet 5.5 o
Haiku 5.5 para que sea más barato. Pagas solo lo que uses (un análisis diario son céntimos).

---

## Arquitectura

```
Packages/WhoopKit/          Núcleo en Swift puro (Foundation) — probado en Linux y macOS
  Protocol/                 Tramas, CRC-8/CRC-32, comandos, parser, decodificador de historial + detector de formato
  Analytics/                Épocas, VFC, sueño y fases, respiración, esfuerzo, calorías, recuperación, estrés, carga
  Training/                 Biblioteca de ejercicios, generador de planes periodizados, adaptación diaria
  Import/                   Importador CSV de Strong, exportador TCX (Strava)
  Model/                    Muestra por segundo (32 bytes), perfil, generador de datos sintéticos
Pulso/                      App iOS (SwiftUI + SwiftData + Swift Charts)
  BLE/                      Driver CoreBluetooth (handshake, descarga con ack, FC en directo, eventos, restauración en 2.º plano)
  Storage/                  Archivos binarios por día (muestras) + SwiftData (días, entrenos, medidas, planes, diario, chat)
  Services/                 Motor de análisis, Claude, Strava, Apple Salud, notificaciones, integraciones, exportación, demo
  Views/                    Hoy, Sueño, Entreno, Coach, Más (tendencias, diario, medidas, respiración, dispositivo, ajustes)
```

Tests del núcleo (21 pruebas: protocolo con paquetes reales capturados, sueño, respiración, esfuerzo, recuperación,
planes, Strong, TCX):

```bash
cd Packages/WhoopKit && swift test
```

## Limitaciones honestas

- Los algoritmos de WHOOP son secretos: Pulso usa métodos científicos publicados, así que los números se parecerán
  pero no serán idénticos a los de la app oficial. Fases de sueño, SpO₂ y temperatura son **estimaciones**.
- La sincronización en segundo plano depende de iOS (restauración Bluetooth + tareas en segundo plano): es fiable
  mientras la pulsera esté cerca, pero iOS decide cuándo despierta la app. Abrirla fuerza una sincronización.
- El despertador «inteligente» solo puede adelantarse si la app está conectada en ese momento; si no, la pulsera vibra a tu hora.
- Los pasos no están documentados en el protocolo: se leen de Apple Salud.
- No es un dispositivo médico. Pulso no está afiliada a WHOOP, Inc.; usa el protocolo documentado por proyectos de
  código abierto con fines de interoperabilidad con tu propio dispositivo.
