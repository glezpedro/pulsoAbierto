# Pulso web — autoalojado en tu servidor

Versión web de Pulso para usar la WHOOP 4.0 **sin firmar ni instalar apps**:

- **En el iPhone**, se abre en **Bluefy** (navegador con Bluetooth). Conecta con la pulsera, descarga el historial y lo sube a tu servidor.
- **En el ordenador**, cualquier navegador muestra todo en pantalla grande.
- **Tu servidor** guarda los datos, calcula las métricas, genera los informes y envía las notificaciones por Telegram.
- Solo es accesible dentro de tu red de Tailscale, por HTTPS: `https://tu-servidor.tu-tailnet.ts.net`.

## Instalación (una vez)

En el servidor, desde la carpeta del proyecto:

```bash
cd ~/pulso
sudo bash server/install.sh
```

El script hace todo esto:

1. Copia el código a `/opt/stacks/pulso/src` y crea `/opt/stacks/pulso/compose.yaml`. Así aparece en **Dockge** como un stack más.
2. Construye la imagen con `docker compose up -d --build`. La primera vez tarda unos 5–10 minutos porque compila el motor de análisis en Swift.
3. Publica el puerto local 8090 en tu tailnet con `tailscale serve --bg --https=443`.

**Para actualizar** a una versión nueva, ejecuta el mismo comando. Los datos están en `/opt/stacks/pulso/data` y no se tocan.

## Primer uso

1. En el iPhone: activa Tailscale, abre **Bluefy** y entra en `https://tu-servidor.tu-tailnet.ts.net`.
   - Si quieres tenerla a mano, añádela a favoritos de Bluefy.
2. **Ajustes** → completa tu perfil.
   - Si no tienes la pulsera todavía, pulsa *Generar 3 semanas de datos demo*.
3. Cierra la app oficial de WHOOP. En Pulso pulsa **Conectar pulsera**, elige tu WHOOP y acepta el emparejamiento de iOS.
   - A partir de ahí, cada vez que abras la web pulsa **Sincronizar**.
   - Mantén la pantalla encendida 1–3 minutos.
4. **Telegram**:
   1. Crea un bot con **@BotFather** (`/newbot`).
   2. Pega el token en Ajustes.
   3. Envía a tu bot `/start CÓDIGO`, con el código que te muestra la web.
5. **Coach IA**: pega tu clave de Anthropic en Ajustes.
6. **Strava**:
   1. Crea tu app en strava.com/settings/api.
   2. En «Authorization Callback Domain» pon `tu-servidor.tu-tailnet.ts.net`.
   3. Pega el Client ID y el Client Secret en Ajustes → Conectar.

## Qué hace

| Sección | Contenido |
|---|---|
| **Hoy** | Recuperación, esfuerzo y sueño. Esfuerzo objetivo, sesión del plan adaptada a tu recuperación, métricas frente a tu media de 30 días, análisis con IA, FC del día y gráfica con todos los sensores (FC, movimiento, temperatura, VFC), estrés y actividades |
| **Sueño** | Puntuación y necesidad desglosada, hipnograma, fases frente a valores de referencia, FC y VFC nocturnas, calidad (latencia, despertares, ciclos REM), hora ideal para acostarte, historial de 30 días y regularidad de horarios |
| **Recuperación** | Qué la compone (z-scores), evolución, VFC y FC en reposo frente a tu normalidad (método Plews), calendario y mediciones de VFC matinales |
| **Esfuerzo y carga** | Zonas de FC, ratio agudo:crónico con zona óptima, monotonía y strain de Foster, semanas y entrenos |
| **Tendencias** | Cualquier métrica en 14 días–1 año, panel comparativo, correlaciones (mismo día o día siguiente), hallazgos automáticos y récords |
| **Informe semanal** | Indicadores frente a la semana anterior, día a día, sueño (deuda y regularidad), carga, zonas, entrenos, hábitos e informe redactado por IA. Se envía a Telegram |
| **Entreno** | Planes periodizados (generador propio o IA) adaptados a cada día, historial unificado (pulsera, directo, Strong, Strava), detalle de cada sesión con FC y zonas, subida a Strava con la curva de FC, progresión de 1RM, récords, series por músculo y volumen semanal |
| **En directo** | FC en vivo con zonas, esfuerzo y calorías en tiempo real, grabación de entrenos (también con doble toque en la pulsera), medición de VFC de 2 minutos y respiración guiada con biofeedback |
| **Pulsera** | Batería con estimaciones (cuánto le queda, hora a la que se agota, tiempo hasta la carga completa, autonomía real por carga e historial), conexión, sincronización, firmware, despertador, vibración, FC por Bluetooth estándar, pulsera de segunda mano, registro y captura de tramas crudas |
| **Medidas, Diario** | Composición corporal y evolución, hábitos con su impacto en la recuperación |
| **Coach IA** (opcional) | Oculto mientras no haya clave de Anthropic (es de pago). Con clave: chat, análisis redactado, planes con IA y respuestas por Telegram |

**Telegram** envía:
- un resumen de la mañana al sincronizar;
- un aviso 30 minutos antes de la hora ideal para acostarte;
- el informe semanal;
- un recordatorio si llevas más de 20 h sin sincronizar;
- un aviso de batería baja;
- un aviso cuando la pulsera detecta una actividad o llega una actividad nueva de Strava.

Comandos del bot: `/hoy`, `/sueno`, `/semana`, `/carga`, `/plan`, `/bateria` y `/coach`. También puedes escribirle cualquier pregunta directamente.

**Strong**: CSV desde la web o con el Atajo de iOS «Enviar a Pulso» (Strong › Exportar › compartir › Enviar a Pulso), que sube el archivo a `POST /api/strong/import-raw`. Instrucciones en Ajustes.

**App Salud**: el botón «Enviar a Salud» (en Resumen y Sueño) ejecuta el Atajo «Pulso a Salud», que escribe en Salud las fases del sueño, la frecuencia cardiaca, la FC en reposo, la respiración y la energía activa. Otro Atajo trae a Pulso los pasos y el peso. Instrucciones de los dos en Ajustes.

**Interfaz**: estilo app Salud de iPhone, en claro u oscuro según el sistema. En el móvil, «Resumen» con tarjetas por categoría que abren el detalle; en el ordenador, todo el detalle en rejilla.

**Sincronización**: barra con el porcentaje, los registros descargados y el tiempo restante, y botón Cancelar seguro: el bloque en curso no se confirma y se queda en la pulsera.

**Copias de seguridad**: todas las noches a las 04:00 se guarda una en `data/backups/` y se conservan 14.

## Arquitectura

```
iPhone (Bluefy) ──BLE──▶ WHOOP 4.0
   │  descarga → cola local IndexedDB → POST /api/samples (32 B/segundo)
   ▼
Tailscale HTTPS (tailscale serve) ──▶ 127.0.0.1:8090 ── contenedor "pulso"
   FastAPI (Python) + SQLite + archivos binarios por día
   pulso-engine (Swift): el mismo núcleo WhoopKit probado de la app iOS
   Telegram (long polling), Strava, Anthropic, tareas programadas
```

**Seguridad**:
- El contenedor solo escucha en `127.0.0.1`.
- Tailscale lo publica únicamente en tu tailnet.
- Para limitarlo a tu usuario de Tailscale, descomenta `PULSO_ALLOWED_LOGINS` en `compose.yaml`. Aun así, `GET /api/health` sigue respondiendo sin login (solo devuelve `{"ok":true}`) para que funcionen el healthcheck del contenedor y Uptime Kuma.
- Las claves (Anthropic, Telegram, Strava) se guardan en el volumen de datos del servidor.

## Limitaciones

- **Bluefy solo sincroniza con la web abierta y la pantalla encendida.** No hay sincronización en segundo plano. La pulsera guarda varios días, así que no se pierde nada si un día no la abres.
- El emparejamiento cifrado desde Bluefy no se ha podido probar sin la pulsera. Si fallara, la pestaña **Pulsera** permite exportar el registro y las tramas para depurarlo.
- Las fases de sueño, la SpO₂ y la temperatura son estimaciones.

## Desarrollo

```bash
cd Packages/WhoopKit && swift test                               # núcleo (22 tests)
node --test server/tests/protocol.test.mjs                       # protocolo en JavaScript (6 tests)
PULSO_DATA=/tmp/pulso PULSO_ENGINE=Packages/WhoopKit/.build/release/pulso-engine \
  uvicorn app.main:app --app-dir server --port 8791              # servidor local
```
