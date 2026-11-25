# Historial de cambios

## 25 de noviembre de 2026

- **Nuevo diseño**: tema azul marino (con claro y automático) y pestañas Inicio · Salud · Sueño · Entreno · Bienestar.
  Inicio con anillos, «De un vistazo», «Plan de hoy» y observaciones; Salud con tendencias, VO₂máx estimado, explorador
  y constantes; detalle de cada dato con tu rango normal y datos para curiosos.
- **Entreno**: sesiones en directo con FC, zonas, esfuerzo, calorías y ruta GPS (distancia, ritmo, exportación GPX).
- **Bienestar**: estrés, respiración guiada, medición de VFC, hábitos, medidas y despertador semanal.
- **Pulsera**: la hora se pone con el formato de la app oficial (sin hora válida la pulsera no graba nada); la
  frecuencia cardiaca se lee bien en los registros de 104 bytes de los firmwares MAXIM 41.17 / NORDIC 17.2, y lo ya
  descargado se corrige solo a partir de los bloques en crudo; registros sin FC (versión 25) aparte.
- **Siestas** de tarde-noche bien contadas; el inicio de la noche ya no cuenta como siesta.
- **Sueño al estilo de la app Salud**: periodos D · S · M · 6M · A, hipnograma, noches por fases, puntuación,
  constantes nocturnas, la noche en detalle, cuándo duermes mejor, regularidad (SRI), jet lag social y cronotipo.
- Páginas de detalle por métrica, explorador por categorías y kit de gráficas SVG táctil.
- Despertador: ver a qué hora está programado y cómo pararlo.
- Copia en crudo de cada bloque de historial (en el móvil y en el servidor) antes de confirmarlo a la pulsera.
- Reconexión sin bloqueos al volver a Bluefy; la web nunca mezcla módulos viejos y nuevos tras actualizar.
- Informe semanal de Telegram con tu mejor hora para acostarte y tu regularidad.

## 24 de noviembre de 2026

- **Versión web autoalojada**: servidor Docker (FastAPI + motor Swift), web para Bluefy y escritorio, Telegram,
  Strava, Strong, informes semanales, copias de seguridad y despliegue con Tailscale.
- Estilo inspirado en la app Salud, envío de datos a Salud con un Atajo y barra de progreso de la sincronización.
- Batería con estimación de autonomía y de carga.
- Pulsera de segunda mano: descartar los datos del dueño anterior.
- Strong: Atajo de iOS «Enviar a Pulso».
- `GET /api/health` público para los healthchecks aunque se restrinja el acceso por usuario de Tailscale.
- **Primera versión**: app de iPhone en SwiftUI con el núcleo `WhoopKit` (protocolo, análisis, planes de entreno).
