# CoreSentry Diagnostics

CoreSentry Diagnostics is a real-time, low-level hardware telemetry and expert diagnostic suite designed for Windows systems (with fallback support for Linux subsystems). By combining direct WMI queries, ACPI thermal zone polling, and an automated LibreHardwareMonitor (LHM) bridge, it acts as a local hardware monitor and diagnostic analyzer.

The interface is built for performance and accessibility, featuring a mobile-responsive dashboard layout, visual tolerance gauges, and interactive self-test utilities.

---

## Key Features

- **Dynamic Hardware Mapping**: Implements a sensor matching cascade (LHM WMI $\rightarrow$ SMBus $\rightarrow$ ASUS EC $\rightarrow$ RAPL/SMU $\rightarrow$ ACPI) to retrieve physical metrics.
- **Tachometer Fallback**: Solves traditional fan mapping issues by actively looking for alternate positive-RPM tachometers if primary sensors are unpopulated.
- **ATX Voltage Margin Analyzer**: Translates direct power rail readings (+12V, +5V, +3.3V) onto visual tolerance meters, alerting you to deviations beyond the ±5% ATX specification.
- **Interactive Fan Curve presets**: Plots live temperature/speed coordinates over three different interactive fan curves (Silent, Standard, and Aggressive Cooling profiles).
- **Active Diagnostic Test Sweep**: Runs programmatic hardware state tests (privileges, WMI accessibility, thermal constraints, and voltage drift) and outputs real-time logs to a terminal console.
- **Mobile-Responsive UI**: Features a custom bottom navigation bar for mobile devices, touch-friendly elements, and a collapsable platform drawer.
- **Canvas Chart Engines**: Fully responsive, high-performance canvas graphs that automatically scale and redraw during window resizing.

---

## Project Directory Structure

```text
core-sentry/
├── backend/
│   └── sensor_monitor.py      # Telemetry state, WMI loops, and local REST API
├── frontend/
│   ├── index.html             # UI loader, Tailwind framework, and custom typography
│   └── App.jsx                # Responsive React dashboard, canvas engines, and test suites
├── LibreHardwareMonitor/      # Automatically downloaded and configured LHM components
├── run.py                     # Main platform launcher and static asset server
└── .gitignore                 # System and build caches exclusion rules
```

---

## Prerequisites

- **Python 3.10 or newer**
- **Windows OS** (with administrative privileges) is recommended to allow the Ring-0 kernel drivers of LibreHardwareMonitor to bind directly to the hardware.
- A modern web browser.

---

## Installation & Running

1. **Clone or Download** this repository to your target directory.
2. Open an **elevated terminal** (Command Prompt or PowerShell run **as Administrator**). This is required to access system hardware registers.
3. Run the orchestration script:
   ```bash
   python run.py
   ```
4. The script will:
   - Start the backend diagnostic API on `http://127.0.0.1:4545`.
   - Boot a lightweight static web server on `http://127.0.0.1:3000`.
   - Automatically open your default web browser to the dashboard.

---

## How It Works Under the Hood

### Telemetry Loop
The Python backend spawns a persistent daemon thread that queries system CIM instances every 1.5 seconds. It checks for CPU/GPU specifications, memory speeds, and storage SMART flags before falling back to LHM and ASUS EC WMI namespaces for precise thermistor voltages and tachometer speeds.

### Expert Diagnostic Logic
CoreSentry analyzes measurements on the fly, comparing CPU thermals, fan RPM feedback loops, and ATX power rail fluctuations against manufacturer safety indices to subtract health points and log anomalies to the system console.

---

## Project Status & Limitations

### ⚠️ Current Status: early-Stage, Unfinished Hobby Utility (WIP)
CoreSentry is an ongoing, lightweight project created as a simple telemetry visualizer rather than an enterprise-grade utility (such as HWiNFO64 or AIDA64). It is provided "as-is" for local diagnostic testing, educational purposes, and quick hardware verifications.

### Known Constraints & Scope Limitations
- **Sensor Naming Inconsistencies**: Motherboard manufacturers often route sensors through custom, non-standard Super I/O channels. Generic mappings (e.g. `Temperature #1`, `Voltage #3`) may map differently depending on your physical motherboard layout.
- **WMI Reliability**: Telemetry is highly dependent on Windows Management Instrumentation (WMI). Corrupt or slow WMI repositories may result in brief polling drops or delayed dashboard refreshes.
- **Operating System Constraints**: Advanced hardware registers (such as Intel RAPL power stats) cannot be queried natively under Linux or standard non-elevated user contexts.

---

## Contributing

Contributions are welcome! Since CoreSentry is a simple, unfinished project, there are many opportunities to expand its hardware coverage and refine its analysis engines.

### How to Help
1. **Expand Hardware Mappings**: Help refine the naming rules in `backend/sensor_monitor.py` by adding regex lookups for additional motherboard models, LPC interfaces, and Super I/O variations (e.g. Fintek, ITE, Nuvoton chips).
2. **Implement Native Linux Support**: Help build an alternate Linux polling subsystem using `lm-sensors`, `/sys/class/thermal`, or custom `/proc` parsers in place of Windows WMI.
3. **Enhance UI Customization**: Improve mobile view layouts, introduce customizable drag-and-drop sensor tiles, or optimize the canvas-based graph scaling.
4. **Report System Conflicts**: Open an issue if a specific motherboard configuration reports inaccurate statuses or mismatched hardware info.

### Development Process
- Fork the repository, create a descriptive branch, and make your changes.
- Ensure your Python code compiles without errors and matches the established style rules.
- Test your modifications under an **Administrator-elevated** context to verify register binding success before submitting a pull request.

---

## License & Acknowledgements

- **LibreHardwareMonitor**: Telemetry bindings are compiled via LibreHardwareMonitor components under the MPL-2.0 License.
- **React**: Declarative rendering engines are powered by the React Library.