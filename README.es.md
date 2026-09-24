<p align="center">
  <img src="assets/banner.png" alt="Cryozen Agent" width="100%">
</p>

# Cryozen Agent

<p align="center">
  <a href="https://cryozenai.github.io/cryozen-agent/docs/"><img src="https://img.shields.io/badge/docs-cryozenai.github.io-7DD3FC?style=for-the-badge" alt="Documentación"></a>
  <a href="https://github.com/cryozenai/cryozen-agent/discussions"><img src="https://img.shields.io/badge/Discusiones-GitHub-388BFD?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Discussions"></a>
  <a href="https://github.com/cryozenai/cryozen-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licencia-MIT-green?style=for-the-badge" alt="Licencia: MIT"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/Lang-English-blue?style=for-the-badge" alt="English"></a>
  <a href="README.ur-pk.md"><img src="https://img.shields.io/badge/Lang-اردو-green?style=for-the-badge" alt="اردو"></a>
</p>

**Cryozen Agent es un agente de IA que mejora por sí mismo, creado por [Cryozen](https://github.com/cryozenai).**
Aprende mientras trabaja: escribe habilidades reutilizables a partir de la experiencia, las perfecciona al usarlas, mantiene una memoria persistente, busca en sus conversaciones pasadas y construye un modelo de cómo te gusta trabajar entre sesiones.
Ejecútalo en tu portátil, en un VPS pequeño, en un servidor con GPU o en infraestructura serverless que casi no cuesta nada cuando está inactiva, y háblale desde la terminal, la aplicación de escritorio o una app de mensajería como Telegram.

Usa el modelo que prefieras: Anthropic, OpenAI, OpenRouter, un servidor de modelos local o [muchos otros proveedores](https://cryozenai.github.io/cryozen-agent/docs/integrations/providers).
Cambia en cualquier momento con `cryozen model`, sin cambios de código y sin dependencia de un proveedor.

<table>
<tr><td><b>Una interfaz de terminal real</b></td><td>TUI completa con edición multilínea, autocompletado de comandos, historial de conversaciones, interrupción y redirección, y salida de herramientas en streaming.</td></tr>
<tr><td><b>Vive donde tú estás</b></td><td>Telegram, Discord, Slack, WhatsApp, Signal, correo y más desde un único proceso gateway, con transcripción de notas de voz y continuidad de conversaciones entre plataformas.</td></tr>
<tr><td><b>Un ciclo de aprendizaje cerrado</b></td><td>Memoria curada por el agente, creación automática de habilidades tras tareas complejas, habilidades que mejoran con el uso y búsqueda de texto completo en sesiones con resúmenes. Las habilidades siguen el formato abierto <a href="https://agentskills.io">agentskills.io</a>.</td></tr>
<tr><td><b>Automatizaciones programadas</b></td><td>Un programador cron integrado que entrega en cualquier plataforma: informes diarios, copias de seguridad nocturnas, auditorías semanales, descritas en lenguaje natural y ejecutadas sin supervisión.</td></tr>
<tr><td><b>Delega y paraleliza</b></td><td>Subagentes aislados para trabajos en paralelo, y scripts de Python que llaman a herramientas por RPC para reducir flujos de varios pasos a un solo turno.</td></tr>
<tr><td><b>Funciona en cualquier lugar</b></td><td>Backends de terminal para local, Docker, SSH, Singularity, Modal, Daytona y Vercel Sandbox. Los backends serverless hibernan cuando están inactivos y despiertan bajo demanda.</td></tr>
<tr><td><b>Listo para investigación</b></td><td>Generación de trayectorias por lotes y compresión de trayectorias para evaluar y entrenar modelos que usan herramientas.</td></tr>
</table>

---

## Instalación rápida

### Linux, macOS, WSL2, Termux

```bash
curl -fsSL https://cryozenai.github.io/cryozen-agent/install.sh | bash
```

### Windows (nativo, PowerShell)

```powershell
iex (irm https://cryozenai.github.io/cryozen-agent/install.ps1)
```

En Windows nativo, Cryozen funciona sin WSL: la CLI, el gateway, la TUI y las herramientas funcionan de forma nativa.
Si prefieres WSL2, el comando de Linux/macOS también funciona allí.

El instalador prepara todo lo necesario: uv, Python 3.11, Node.js, ripgrep, ffmpeg y, en Windows, un Git Bash portátil (MinGit, descomprimido en `%LOCALAPPDATA%\cryozen\git`, sin permisos de administrador y aislado de cualquier Git del sistema).
Si Git ya está instalado, el instalador lo utiliza.

En Android, sigue la [guía de Termux](https://cryozenai.github.io/cryozen-agent/docs/getting-started/termux).

Después de la instalación:

```bash
source ~/.bashrc    # recarga tu shell (o: source ~/.zshrc)
cryozen             # empieza a conversar
```

---

## Primeros pasos

```bash
cryozen              # CLI interactiva: inicia una conversación
cryozen model        # elige proveedor y modelo
cryozen tools        # elige qué herramientas están activas
cryozen config set   # establece un valor de configuración
cryozen config get   # muestra un valor de configuración
cryozen gateway      # ejecuta el gateway de mensajería (Telegram, Discord, ...)
cryozen setup        # asistente de configuración completo
cryozen claw migrate # importa la configuración desde OpenClaw
cryozen update       # actualiza a la última versión
cryozen doctor       # diagnostica problemas
```

Documentación completa: **[cryozenai.github.io/cryozen-agent/docs](https://cryozenai.github.io/cryozen-agent/docs/)**

---

## Referencia rápida: CLI y mensajería

Inicia la interfaz de terminal con `cryozen`, o ejecuta el gateway y habla con Cryozen desde Telegram, Discord, Slack, WhatsApp, Signal o correo.
La mayoría de los comandos funcionan en ambos.

| Acción                           | CLI                                           | Plataformas de mensajería                                                         |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Empezar a conversar              | `cryozen`                                     | Ejecuta `cryozen gateway setup` y `cryozen gateway start`, y escribe al bot        |
| Nueva conversación               | `/new` o `/reset`                             | `/new` o `/reset`                                                                 |
| Cambiar de modelo                | `/model [proveedor:modelo]`                   | `/model [proveedor:modelo]`                                                       |
| Elegir una personalidad          | `/personality [nombre]`                       | `/personality [nombre]`                                                           |
| Reintentar o deshacer            | `/retry`, `/undo`                             | `/retry`, `/undo`                                                                 |
| Comprimir contexto / ver uso     | `/compress`, `/usage`, `/insights [--days N]` | `/compress`, `/usage`, `/insights [días]`                                         |
| Explorar habilidades             | `/skills` o `/<habilidad>`                    | `/<habilidad>`                                                                    |
| Interrumpir el trabajo actual    | `Ctrl+C` o envía un mensaje nuevo             | `/stop` o envía un mensaje nuevo                                                  |
| Estado de la plataforma          | `/platforms`                                  | `/status`, `/sethome`                                                             |

---

## Migrar desde OpenClaw

Cryozen puede importar tu configuración, memorias, habilidades y claves de API de OpenClaw.
El asistente (`cryozen setup`) detecta `~/.openclaw` y ofrece migrar antes de configurar, o puedes ejecutarlo en cualquier momento:

```bash
cryozen claw migrate                    # migración interactiva (preset completo)
cryozen claw migrate --dry-run          # vista previa de lo que se migraría
cryozen claw migrate --preset user-data # migrar sin secretos
cryozen claw migrate --overwrite        # sobrescribir conflictos existentes
```

---

## Desarrollo

Consulta la [guía de contribución](https://cryozenai.github.io/cryozen-agent/docs/developer-guide/contributing) para la configuración de desarrollo, el estilo de código y el proceso de pull requests.

```bash
curl -fsSL https://cryozenai.github.io/cryozen-agent/install.sh | bash
cd "${CRYOZEN_HOME:-$HOME/.cryozen-agent}/cryozen-agent"
uv pip install -e ".[all,dev]"
scripts/run_tests.sh
```

---

## Soporte

- Preguntas e ideas: [GitHub Discussions](https://github.com/cryozenai/cryozen-agent/discussions)
- Errores: [GitHub Issues](https://github.com/cryozenai/cryozen-agent/issues)
- Informes de seguridad: consulta [SECURITY.es.md](SECURITY.es.md)

---

## Licencia

Cryozen Agent se publica bajo la licencia MIT; consulta [LICENSE](LICENSE) y [NOTICE](NOTICE).

Copyright (c) 2026 Cryozen.
