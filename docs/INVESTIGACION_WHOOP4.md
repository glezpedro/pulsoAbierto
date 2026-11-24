# WHOOP 4.0 — Investigación técnica (noviembre 2026)

Resumen de lo que se sabe del dispositivo, qué datos emite y cómo, y cómo funcionan los proyectos
de la comunidad que lo usan sin suscripción. Es la base sobre la que está construida Pulso.

---

## 1. El hardware

| Componente | Detalle |
|---|---|
| Sensor óptico (PPG) | 5 LED (3 verdes, 1 rojo, 1 infrarrojo) + fotodiodos. Verde → frecuencia cardiaca / R-R; rojo + IR → SpO₂ |
| Temperatura | Sensor de temperatura **de la piel** (no corporal central) |
| Movimiento | Acelerómetro + giroscopio de 3 ejes (IMU) |
| Otros | Motor de vibración (alarmas/hápticos), sensor capacitivo de contacto con la piel, luz ambiente |
| Procesadores | Maxim (procesado de señal, firmware "Harvard", p. ej. 41.17.6.0) + Nordic **nRF52840** (Bluetooth, p. ej. 17.2.2.0) |
| Batería | 4–5 días; *battery pack* inalámbrico con su propio acelerómetro (doble toque) |
| Resistencia | IP68, hasta 10 m |
| Memoria | Guarda los datos en flash y los descarga por BLE a trozos cuando hay un teléfono |

La pulsera **no tiene pantalla** y **no calcula** recuperación, sueño ni esfuerzo: graba datos crudos
cada segundo y es la app (o los servidores de WHOOP) la que calcula todo. Por eso se puede hacer una app propia.

## 2. Qué ofrece WHOOP oficialmente (y por qué no basta)

- **API oficial** (developer.whoop.com): solo datos ya procesados (recuperación, sueño, ciclos, entrenos),
  requiere membresía activa y **no da frecuencia cardiaca continua**.
- **Exportación CSV** desde la app: métricas diarias, también con membresía.
- **Broadcast HR**: la pulsera puede emitir la FC como una banda de pecho estándar (perfil Bluetooth Heart Rate).

Sin suscripción la app oficial deja de funcionar, pero **el hardware sigue grabando** y hablando Bluetooth.

## 3. El protocolo Bluetooth (BLE)

### 3.1 Servicios y características (GATT)

| Nombre | UUID | Tipo | Uso |
|---|---|---|---|
| Servicio WHOOP | `61080001-8d6d-82b8-614a-1c8cb0f8dcc6` | servicio | anunciado al escanear |
| CMD_TO_STRAP | `61080002-…` | write | comandos app → pulsera |
| CMD_FROM_STRAP | `61080003-…` | notify | respuestas a comandos (tipo 36) |
| EVENTS_FROM_STRAP | `61080004-…` | notify | eventos (tipo 48) |
| DATA_FROM_STRAP | `61080005-…` | notify | historial / tiempo real (**fragmentado**) |
| MEMFAULT | `61080007-…` | notify | logs de fallos |
| Heart Rate (estándar) | `180D` / `2A37` | notify | FC + R-R en 1/1024 s, sin emparejar |
| Battery (estándar) | `180F` / `2A19` | read/notify | algunas unidades devuelven siempre 100 |

### 3.2 Formato de trama (verificado con paquetes reales)

```
[0]        0xAA                      inicio de trama
[1..2]     L (u16 little-endian)     = bytes tras la cabecera de 4, CRC32 incluido
[3]        CRC-8 de [1..2]           polinomio 0x07, init 0x00
[4]        tipo de paquete
[5]        nº de secuencia
[6]        comando / subtipo
[7..L)     carga útil
[L..L+4)   CRC-32 zlib de [4..L)     (poly reflejado 0xEDB88320), little-endian
Tamaño total = L + 4
```

Comprobado sobre 6 capturas reales (p. ej. `aa0800a8 23 08 0e 01 6c935474` = activar broadcast de FC):
coinciden la CRC-8 y la CRC-32. Ver `Packages/WhoopKit/Tests/WhoopKitTests/ProtocolTests.swift`.

Respuesta (tipo 36): `[6]` comando, `[7]` secuencia original, `[8]` resultado (0 fallo, 1 éxito,
2 pendiente, 3 no soportado), `[9..]` cuerpo.

### 3.3 Tipos de paquete

| Tipo | Nombre | Contenido |
|---|---|---|
| 35 (0x23) | COMMAND | app → pulsera |
| 36 | COMMAND_RESPONSE | respuesta |
| 40 (0x28) | REALTIME_DATA | FC + R-R en directo, 1/s |
| 43 | REALTIME_RAW_DATA | IMU (100 muestras/eje) u óptico crudo, ~2/s |
| 47 (0x2F) | HISTORICAL_DATA | **un registro por segundo** del historial |
| 48 (0x30) | EVENT | eventos |
| 49 (0x31) | METADATA | HISTORY_START (1) / END (2) / COMPLETE (3) |
| 50 | CONSOLE_LOGS | logs |

### 3.4 Comandos principales (WHOOP 4)

| Nº | Comando | Cuerpo |
|---|---|---|
| 3 | TOGGLE_REALTIME_HR | `01`/`00` |
| 7 | REPORT_VERSION_INFO | versiones Maxim/Nordic |
| 10 | SET_CLOCK | unix u32 + 4×00 — **imprescindible: el reloj viene a 0** |
| 11 | GET_CLOCK | |
| 14 | TOGGLE_GENERIC_HR_PROFILE | `01`/`00` — emitir FC como banda estándar |
| 20 | ABORT_HISTORICAL_TRANSMITS | `00` |
| 22 | SEND_HISTORICAL_DATA | `00` — inicia la descarga del historial |
| 23 | HISTORICAL_DATA_RESULT | `01` + bloque de 8 bytes del HISTORY_END — confirma (y borra) un bloque |
| 26 | GET_BATTERY_LEVEL | respuesta u16 / 10 = % |
| 29 | REBOOT_STRAP | |
| 34 | GET_DATA_RANGE | |
| 35 | GET_HELLO_HARVARD | nº de serie en offset 14 del cuerpo |
| 63 | SEND_R10_R11_REALTIME | `00` para parar el flujo crudo tipo 43 |
| 66 | SET_ALARM_TIME | `01` + unix u32 + 4×00 |
| 68 / 69 | RUN_ALARM / DISABLE_ALARM | `01` |
| 76 | GET_ADVERTISING_NAME | |
| 79 | RUN_HAPTICS_PATTERN | `02 03 00 00 00` (patrón probado) |
| 84 | GET_BODY_LOCATION_AND_STATUS | muñeca, bíceps, etc. |
| 96–98 | Sincronización de alta frecuencia / batería extendida | |
| ⚠️ 25, 32, 36–38, 45, 99 | FORCE_TRIM, POWER_CYCLE, firmware, DFU, fuel gauge | **destructivos: Pulso nunca los envía** |

### 3.5 Eventos (tipo 48, código en `[6]`, unix en `[8]`)

3 batería (SoC u16@17/10, mV@21, carga bit0@26) · 7/8 carga on/off · 9/10 pulsera puesta/quitada ·
13 reloj perdido · 14 doble toque · 17 temperatura · 23 emparejada · 33/34 FC en directo on/off ·
56–59 alarmas · 60/100 vibración · 63 batería extendida · 96–98 sincronización rápida.

### 3.6 Registro histórico "v24" (trama de 96 bytes, firmware 41.17.x)

| Offset | Tipo | Campo |
|---|---|---|
| 11 | u32 | timestamp unix |
| 21 | u8 | FC (lpm) |
| 22 | u8 | nº de intervalos R-R (0–4) |
| 23 | 4 × u16 | intervalos R-R (ms) |
| 33 / 35 | u16 | ópticos crudos verde / rojo-IR |
| 40 / 44 / 48 | f32 | vector de gravedad (≈ 1 g) → postura y movimiento |
| 55 | u8 | contacto con la piel (0 = fuera de la muñeca) |
| 56 / 60 / 64 | f32 | segundo vector de gravedad |
| 68 / 70 | u16 | rojo / IR crudos (relacionados con SpO₂, **no** es un %) |
| 72 | u16 | temperatura de piel (ADC crudo, sin calibrar) |
| 74 | u16 | luz ambiente |
| 80 | u16 | dato relacionado con respiración (crudo) |
| 82 | u16 | calidad de señal |

Firmwares más nuevos usan un registro **"v25" de 84 bytes** (timestamp en 11, movimiento en 73/75/77)
cuyo campo de FC no está documentado públicamente. **Pulso incluye un detector automático** que busca
el offset de la FC puntuando la coherencia FC ↔ R-R y la continuidad segundo a segundo, así que debería
seguir funcionando aunque cambie el formato (y permite capturar tramas crudas para analizarlas).

### 3.7 Conexión y descarga (máquina de estados)

1. Escanear el servicio `61080001`, conectar, descubrir.
2. **Escritura confirmada de GET_BATTERY_LEVEL** → iOS muestra el diálogo de emparejamiento (la
   característica está cifrada). Tras su confirmación el canal de comandos funciona.
3. Suscribirse a 0003, 0004, 0005, 2A37, 2A19.
4. HELLO → nombre → versiones → **SET_CLOCK** → GET_CLOCK → parar flujo crudo (63=00) → GET_DATA_RANGE.
5. `SEND_HISTORICAL_DATA` → `HISTORY_START` → N registros tipo 47 → `HISTORY_END` (con *trim cursor*)
   → **guardar en disco** → `HISTORICAL_DATA_RESULT` con el bloque de 8 bytes tal cual → siguiente bloque … `HISTORY_COMPLETE`.
6. Si no se confirma un bloque, la pulsera lo reenvía: nunca se pierden datos por un fallo de guardado.

La pulsera **solo admite un enlace cifrado a la vez**: hay que cerrar la app oficial. La FC estándar
(2A37) funciona sin emparejar.

## 4. Proyectos de la comunidad

| Proyecto | Tecnología | Qué hace |
|---|---|---|
| **bWanShiTong/reverse-engineering-whoop-post** + **openwhoop** | Python / Rust | Primer análisis público: capturas de Wireshark, CRC, comandos, descarga del historial; openwhoop calcula strain/recuperación/VFC |
| **NOOP** (ryanbr/noop, forks ujix/noop) | Swift/SwiftUI (iOS, macOS) + Kotlin | App completa offline: recuperación, strain, sueño con fases, VFC, estrés, respiración guiada, coach IA con clave propia. Documenta el protocolo con más detalle (PROTOCOL_*.md). Licencia no comercial |
| **OpenStrap / edge** (y forks) | Flutter | App local para iOS/Android con sueño, recuperación, strain, estrés, entrenos con GPS, exportación a Salud/Health Connect, alarma inteligente; métricas "aproximadas a partir de la literatura" |
| **christianmeurer/whoop-reader** | Python | Lector CLI en tiempo real (FC, R-R, campos candidatos) |
| **cs-balazs/gowhoop** | Go + ClickHouse + Grafana | Volcado a base de datos y paneles |

Todos coinciden en: los algoritmos de WHOOP son privados, así que se recalculan con métodos
publicados (Task Force 1996 para VFC, Karvonen/Banister para carga, etc.); los números no serán
idénticos a los oficiales; y **actualizar el firmware con la app oficial puede cambiar el formato**.

## 5. Qué datos se pueden obtener (y qué hace Pulso con ellos)

| Dato | Fuente | Calidad | En Pulso |
|---|---|---|---|
| FC cada segundo | historial tipo 47 / 2A37 | ✅ buena | todo |
| Intervalos R-R | historial / 2A37 | ✅ buena | VFC (RMSSD, SDNN, pNN50), respiración (RSA), estrés, fases |
| Gravedad / movimiento | historial | ✅ | detección de sueño, actividad, postura |
| Contacto con la piel | historial | ✅ | uso diario, filtrado |
| Temperatura de piel | historial (ADC) | ⚠️ sin calibrar | desviación relativa frente a tu base (σ) |
| Rojo / IR | historial | ⚠️ crudo | SpO₂ experimental (cociente de cocientes), opcional |
| Batería, carga, puesta/quitada, doble toque | eventos | ✅ | estado, registro, atajos |
| Vibración / alarma | comandos | ✅ | despertador (inteligente si la app está conectada) |
| Pasos | — | ❌ no documentado | se leen de Apple Salud |

## 6. Fuentes

- https://github.com/bWanShiTong/reverse-engineering-whoop-post
- https://github.com/ujix/noop (docs/PROTOCOL_WHOOP4.md, PROTOCOL_TRANSPORT.md, PROTOCOL_COMMANDS.md, PROTOCOL_SENSORS.md, IOS.md)
- https://github.com/egoran2/edge · https://github.com/dannymcc/edge (OpenStrap)
- https://github.com/christianmeurer/whoop-reader
- https://github.com/cs-balazs/gowhoop
- https://hackaday.com/2026/07/15/making-a-locked-down-wearable-work-without-a-subscription/
- https://developer.whoop.com/docs/developing/support
- https://www.whoop.com/thelocker/chief-technology-officer-whoop-4-0-accuracy
- https://the5krunner.com/specs/whoop/4-0/ · https://www.tomsguide.com/reviews/whoop-4
