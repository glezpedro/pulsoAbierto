# App de iPhone (SwiftUI) — experimental

La primera versión de Pulso fue una app nativa de iOS. Sigue en la carpeta `Pulso/` y comparte el núcleo `Packages/WhoopKit`,
pero el camino recomendado hoy es la **versión web autoalojada** (ver el README principal): no hay que firmar ni renovar apps.

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

