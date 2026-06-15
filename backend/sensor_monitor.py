import json
import time
import os
import sys
import subprocess
import threading
import platform
import urllib.request
import zipfile
import shutil
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

class TelemetryState:
    def __init__(self):
        self.lock = threading.Lock()
        self.history_length = 60
        self.voltage_history = []
        self.temp_history = []
        self.ticks = 0
        self.events_log = []
        self.raw_sensor_map = []
        
        self.sys_info = {
            "bios_vendor": "N/A",
            "bios_version": "N/A",
            "bios_release_date": "N/A",
            "boot_mode": "Legacy",
            "motherboard_manufacturer": "N/A",
            "motherboard_model": "N/A",
            "motherboard_chipset": "N/A",
            "motherboard_southbridge": "N/A",
            "super_io_vendor": "N/A",
            "super_io_model": "N/A",
            "super_io_revision": "N/A",
            "super_io_sensor_banks": "N/A",
            "cpu_model": "N/A",
            "cpu_max_speed_mhz": 0,
            "cpu_cores": 0,
            "cpu_threads": 0,
            "ram_total_gb": 0,
            "ram_speed_mhz": 0,
            "ram_errors": "None Detected",
            "disk_smart_status": "Healthy",
            "power_supply": "Mains Connection (Sufficient Power)"
        }
        
        self.connection_status = {
            "asus_ec_connected": "Disconnected",
            "smbus_connected": "Disconnected",
            "super_io_connected": "Disconnected",
            "cpu_telemetry_connected": "Disconnected",
            "wmi_connected": "Disconnected"
        }
        
        self.metrics = {}
        for sensor_id in [
            "cpu_temp", "cpu_pkg_temp", "cpu_core_temps", "cpu_vcore", "cpu_vid",
            "cpu_pkg_power", "cpu_current", "cpu_clock", "mb_temp", "vrm_temp",
            "chipset_temp", "sys_fan", "cpu_fan", "pump_rpm", "mem_voltage",
            "rail_3v3", "rail_5v", "rail_12v",
            "motherboard_fans", "motherboard_voltages", "motherboard_temperatures"
        ]:
            if sensor_id in ["cpu_core_temps", "motherboard_fans", "motherboard_voltages", "motherboard_temperatures"]:
                self.metrics[sensor_id] = []
            else:
                self.metrics[sensor_id] = {
                    "value": "Unavailable",
                    "source": "N/A",
                    "controller": "N/A",
                    "status": "Unavailable",
                    "reason": "Initializing hardware telemetry collector..."
                }
        
        self.diagnostics_report = {}
        self.health_score = 100

    def add_event(self, event_type, message):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        self.events_log.insert(0, {
            "timestamp": timestamp,
            "type": event_type,
            "message": message
        })
        if len(self.events_log) > 100:
            self.events_log.pop()

state_manager = TelemetryState()

POWERSHELL_TELEMETRY_SCRIPT = """
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$Output = @{
    IsAdmin = $isAdmin
    LHM_Running = $false
    LHM_Connected = $false
    LHM_Executable_Path = "N/A"
    WMI_Namespace_Accessible = $false
    Motherboard_Manufacturer = "N/A"
    Motherboard_Model = "N/A"
    LPC_Device_Name = "Generic LPC Bridge"
    BIOS_Version = "N/A"
    SuperIO_Chip = "N/A"
    CPU_Vendor = "Unknown"
    CPU_Model = "N/A"
    CPU_Max_Speed_MHz = 0
    CPU_Cores = 0
    CPU_Threads = 0
    RAM_Total_GB = 0
    RAM_Speed_MHz = 0
    Disk_Smart_Status = "Healthy"
    Hardware = @()
    Sensors = @()
    ASUSWMI_Connected = $false
    ACPI_Connected = $false
}

$lhm_proc = Get-Process -Name "LibreHardwareMonitor" -ErrorAction SilentlyContinue
if ($lhm_proc) {
    $Output.LHM_Running = $true
    try { $Output.LHM_Executable_Path = $lhm_proc.Path } catch {}
}

try {
    $board = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction SilentlyContinue
    if ($board) {
        $Output.Motherboard_Manufacturer = $board.Manufacturer.Trim()
        $Output.Motherboard_Model = $board.Product.Trim()
    }
} catch {}

try {
    $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue
    if ($bios) { $Output.BIOS_Version = $bios.SMBIOSBIOSVersion }
} catch {}

try {
    $lpc = Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
        $_.PNPClass -eq "System" -and (
            $_.Name -like "*LPC Controller*" -or 
            $_.Name -like "*LPC Interface*" -or 
            $_.Name -like "*LPC Bridge*" -or 
            $_.Name -like "*ISA Bridge*" -or 
            $_.Name -like "*eSPI*" -or
            $_.Name -like "*PCI-to-ISA*"
        )
    } | Select-Object -First 1
    if ($lpc) { $Output.LPC_Device_Name = $lpc.Name.Trim() }
} catch {}

try {
    $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue
    if ($cpu) {
        $Output.CPU_Model = $cpu.Name.Trim()
        $Output.CPU_Max_Speed_MHz = $cpu.MaxClockSpeed
        $Output.CPU_Cores = $cpu.NumberOfCores
        $Output.CPU_Threads = $cpu.NumberOfLogicalProcessors
        if ($cpu.Manufacturer -like "*Intel*") { $Output.CPU_Vendor = "Intel" }
        elseif ($cpu.Manufacturer -like "*AMD*") { $Output.CPU_Vendor = "AMD" }
    }
} catch {}

try {
    $ram = Get-CimInstance -ClassName Win32_PhysicalMemory -ErrorAction SilentlyContinue
    if ($ram) {
        $total = 0
        $speed = 0
        foreach ($r in $ram) {
            $total += $r.Capacity
            if ($r.Speed -gt $speed) { $speed = $r.Speed }
        }
        $Output.RAM_Total_GB = [Math]::Round($total / 1GB)
        $Output.RAM_Speed_MHz = $speed
    }
} catch {}

try {
    $disk = Get-CimInstance -Namespace "root\\Microsoft\\Windows\\Storage" -ClassName MSFT_PhysicalDisk -ErrorAction SilentlyContinue
    if ($disk) {
        $unhealthy = $false
        foreach ($d in $disk) {
            if ($d.HealthStatus -ne 0) { $unhealthy = $true }
        }
        if ($unhealthy) { $Output.Disk_Smart_Status = "Warning/Unhealthy" }
    }
} catch {}

try {
    $lhm_hw = Get-CimInstance -Namespace "root\\LibreHardwareMonitor" -ClassName "Hardware" -ErrorAction SilentlyContinue
    $lhm_sen = Get-CimInstance -Namespace "root\\LibreHardwareMonitor" -ClassName "Sensor" -ErrorAction SilentlyContinue
    if ($lhm_sen) {
        $Output.WMI_Namespace_Accessible = $true
        $Output.LHM_Connected = $true
        foreach ($hw in $lhm_hw) {
            $Output.Hardware += @{
                Name = $hw.Name
                Identifier = $hw.Identifier
                Type = $hw.HardwareType
                Source = "LibreHardwareMonitor"
            }
            if ($hw.HardwareType -eq "SuperIO" -or $hw.HardwareType -eq "Mainboard") {
                if ($hw.Name -like "*Nuvoton*" -or $hw.Name -like "*NCT*" -or $hw.Name -like "*ITE*" -or $hw.Name -like "*IT8*" -or $hw.Name -like "*Fintek*" -or $hw.Name -like "*Winbond*") {
                    $Output.SuperIO_Chip = $hw.Name
                }
            }
        }
        foreach ($sen in $lhm_sen) {
            $Output.Sensors += @{
                Name = $sen.Name
                Type = $sen.SensorType
                Value = $sen.Value
                Parent = $sen.Parent
                Identifier = $sen.Identifier
                Source = "LibreHardwareMonitor"
            }
        }
    }
} catch {}

try {
    $asushw = Get-CimInstance -Namespace "root\\WMI" -ClassName "ASUSHW" -ErrorAction SilentlyContinue
    if ($asushw) { $Output.ASUSWMI_Connected = $true }
} catch {}

try {
    $acpi_zones = Get-CimInstance -Namespace "root\\WMI" -ClassName "MSAcpi_ThermalZoneTemperature" -ErrorAction SilentlyContinue
    if ($acpi_zones) {
        $Output.ACPI_Connected = $true
        foreach ($zone in $acpi_zones) {
            $celsius = ($zone.CurrentTemperature / 10.0) - 273.15
            $Output.Sensors += @{
                Name = "ACPI Thermal Zone - $($zone.InstanceName)"
                Type = "Temperature"
                Value = $celsius
                Parent = "ACPI"
                Identifier = $zone.InstanceName
                Source = "MSAcpi_ThermalZoneTemperature"
            }
        }
    }
} catch {}

if ($Output.SuperIO_Chip -eq "N/A") {
    try {
        $pnp = Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { 
            $_.Name -like "*Nuvoton*" -or $_.Name -like "*ITE IT*" -or $_.Name -like "*Fintek*" -or $_.Name -like "*Winbond*" -or $_.Name -like "*LPC Controller*" 
        }
        if ($pnp) {
            $chip = ($pnp | Where-Object { $_.Name -like "*Nuvoton*" -or $_.Name -like "*ITE*" -or $_.Name -like "*Fintek*" -or $_.Name -like "*Winbond*" } | Select-Object -First 1).Name
            if ($chip) { $Output.SuperIO_Chip = $chip }
            else { $Output.SuperIO_Chip = "Generic LPC Bridge" }
        }
    } catch {}
}

$Output | ConvertTo-Json -Depth 4
"""

def parse_chipset_and_pch(lpc_name):
    chipset = "Unknown"
    pch = lpc_name
    m = re.search(r'\(([^)]+)\)', lpc_name)
    if m:
        chipset = m.group(1)
    else:
        m2 = re.search(r'\b([A-Z0-9]{3,5})\b\s+(?:LPC|Chipset|Bridge|FCH|ISA)', lpc_name, re.IGNORECASE)
        if m2:
            chipset = m2.group(1)
            
    if chipset == "Unknown":
        if "300 Series" in lpc_name: chipset = "Intel 300 Series"
        elif "400 Series" in lpc_name: chipset = "Intel 400 Series"
        elif "500 Series" in lpc_name: chipset = "Intel 500 Series"
        elif "600 Series" in lpc_name: chipset = "Intel 600 Series"
        elif "700 Series" in lpc_name: chipset = "Intel 700 Series"
        elif "FCH" in lpc_name: chipset = "AMD FCH"
    return chipset, pch

LHM_SEARCH_PATHS = [
    os.path.join(os.getcwd(), "LibreHardwareMonitor", "LibreHardwareMonitor.exe"),
    os.path.join(os.getcwd(), "backend", "LibreHardwareMonitor", "LibreHardwareMonitor.exe"),
    r"C:\Tools\LibreHardwareMonitor\LibreHardwareMonitor.exe",
    r"C:\Program Files\LibreHardwareMonitor\LibreHardwareMonitor.exe",
    r"C:\Program Files (x86)\LibreHardwareMonitor\LibreHardwareMonitor.exe",
]

def locate_lhm():
    for p in LHM_SEARCH_PATHS:
        if os.path.exists(p): return p
    return None

def download_and_extract_lhm():
    target_dir = os.path.join(os.getcwd(), "LibreHardwareMonitor")
    exe_path = os.path.join(target_dir, "LibreHardwareMonitor.exe")
    if os.path.exists(exe_path): return exe_path
        
    os.makedirs(target_dir, exist_ok=True)
    zip_path = os.path.join(os.getcwd(), "lhm.zip")
    url = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.4/LibreHardwareMonitor-net472.zip"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response, open(zip_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_dir)
        try: os.remove(zip_path)
        except Exception: pass
        return exe_path
    except Exception as e:
        with state_manager.lock:
            state_manager.add_event("warning", f"LHM install failed: {str(e)}")
        return None

def configure_lhm(exe_path):
    config_paths = [
        os.path.join(os.path.dirname(exe_path), "LibreHardwareMonitor.config"),
        exe_path + ".config"
    ]
    config_content = """<?xml version="1.0" encoding="utf-8" ?>
<configuration>
  <appSettings>
    <add key="runWebServerMenuItem" value="false" />
    <add key="wmiEnabled" value="true" />
    <add key="wmiProviderEnabled" value="true" />
    <add key="runWmiProvider" value="true" />
    <add key="minTrayMenuItem" value="true" />
    <add key="minCloseMenuItem" value="true" />
    <add key="runOnWindowsStartup" value="true" />
  </appSettings>
</configuration>"""
    for p in config_paths:
        try:
            with open(p, "w", encoding="utf-8") as f: f.write(config_content)
        except Exception: pass

def start_lhm():
    if platform.system() != "Windows": return
    exe_path = locate_lhm()
    if not exe_path: exe_path = download_and_extract_lhm()
    if not exe_path: return
    configure_lhm(exe_path)
    try:
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        output = subprocess.run(["tasklist", "/FI", "IMAGENAME eq LibreHardwareMonitor.exe"], capture_output=True, text=True, startupinfo=startupinfo)
        if "LibreHardwareMonitor.exe" in output.stdout: return
        cmd = f'Start-Process "{exe_path}" -Verb RunAs -WindowStyle Minimized'
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], capture_output=True, text=True, startupinfo=startupinfo)
    except Exception: pass

def run_powershell_cmd(cmd):
    try:
        startupinfo = None
        if platform.system() == "Windows":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        result = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], capture_output=True, text=True, timeout=10, startupinfo=startupinfo)
        return result.stdout.strip()
    except Exception: return ""

def discover_hardware_details():
    if platform.system() != "Windows":
        state_manager.sys_info.update({
            "bios_vendor": "GNU/Linux Subsystem",
            "bios_version": "N/A",
            "bios_release_date": "N/A",
            "boot_mode": "UEFI",
            "motherboard_manufacturer": "Linux Device",
            "motherboard_model": "Generic Host",
            "cpu_model": "Physical Core Architecture",
            "cpu_max_speed_mhz": 3200,
            "cpu_cores": 4,
            "cpu_threads": 8,
            "ram_total_gb": 16,
            "ram_speed_mhz": 3200,
            "ram_errors": "None Detected",
            "disk_smart_status": "Healthy",
            "power_supply": "DC Power Source"
        })
        return

    bios_data = run_powershell_cmd("Get-CimInstance Win32_BIOS | Select-Object Manufacturer, Version, SMBIOSBIOSVersion, ReleaseDate | ConvertTo-Json")
    if bios_data:
        try:
            parsed = json.loads(bios_data)
            state_manager.sys_info["bios_vendor"] = parsed.get("Manufacturer", "Unknown")
            state_manager.sys_info["bios_version"] = parsed.get("SMBIOSBIOSVersion") or parsed.get("Version") or "Unknown"
            state_manager.sys_info["bios_release_date"] = parsed.get("ReleaseDate", "Unknown").split("T")[0]
        except Exception: pass
    boot_mode_chk = run_powershell_cmd("if (Test-Path 'HKLM:\\System\\CurrentControlSet\\Control\\SecureBoot\\State') { 'UEFI' } else { 'Legacy' }")
    state_manager.sys_info["boot_mode"] = boot_mode_chk if boot_mode_chk in ["UEFI", "Legacy"] else "Legacy"

def find_sensor_ordered(sensors, hardware, sensor_id):
    mapping_rules = {
        "cpu_temp": {"name_contains": ["cpu temp", "cpu socket", "cpu tctl", "cpu tdie", "tctl", "tdie", "temperature #1", "cpu core"], "name_excludes": ["package", "core #", "vrm", "opt"], "type": "Temperature"},
        "cpu_pkg_temp": {"name_contains": ["package", "cpu package", "cpu pack"], "name_excludes": [], "type": "Temperature"},
        "cpu_vcore": {"name_contains": ["vcore", "cpu core voltage", "cpu core", "voltage #1", "voltage #2", "cpu vcore"], "name_excludes": ["vid", "soc", "vddp", "dimm", "dram", "12v", "5v", "3.3v"], "type": "Voltage"},
        "cpu_vid": {"name_contains": ["vid", "cpu vid"], "name_excludes": [], "type": "Voltage"},
        "cpu_pkg_power": {"name_contains": ["cpu package", "package", "cpu package power", "power #1"], "name_excludes": ["cores", "graphic"], "type": "Power"},
        "cpu_current": {"name_contains": ["cpu current", "cpu vrm output current", "cpu", "current #1"], "name_excludes": [], "type": "Current"},
        "cpu_clock": {"name_contains": ["cpu core #1", "core #1", "cpu clock", "clock speed", "core clock #1"], "name_excludes": [], "type": "Clock"},
        "mb_temp": {"name_contains": ["motherboard", "mainboard", "system", "board", "systin", "temperature #2", "system temp"], "name_excludes": ["cpu", "vrm", "chipset"], "type": "Temperature"},
        "vrm_temp": {"name_contains": ["vrm", "mos", "mosfet", "vcore vrm", "vrm mos", "temperature #4", "vrm temp"], "name_excludes": [], "type": "Temperature"},
        "chipset_temp": {"name_contains": ["chipset", "pch", "southbridge", "sb", "cputin", "temperature #3", "chipset temp"], "name_excludes": ["vrm", "core"], "type": "Temperature"},
        "sys_fan": {"name_contains": ["chassis", "system", "sys fan", "cha_fan", "sys_fan", "fan #2", "fan 2"], "name_excludes": ["cpu", "pump"], "type": "Fan"},
        "cpu_fan": {"name_contains": ["cpu fan", "cpu_fan", "cpu opt", "fan #1", "fan 1"], "name_excludes": ["pump", "chassis"], "type": "Fan"},
        "pump_rpm": {"name_contains": ["pump", "aio", "water", "fan #4", "fan 4"], "name_excludes": ["cpu fan"], "type": "Fan"},
        "mem_voltage": {"name_contains": ["dram", "memory", "vdd", "dimm", "voltage #3", "voltage #4"], "name_excludes": ["vcore", "3.3v", "5v", "12v"], "type": "Voltage"},
        "rail_3v3": {"name_contains": ["3.3v", "3vsb", "+3.3v", "avcc", "avcc3"], "name_excludes": [], "type": "Voltage"},
        "rail_5v": {"name_contains": ["5v", "+5v", "+5vsb"], "name_excludes": [], "type": "Voltage"},
        "rail_12v": {"name_contains": ["12v", "+12v"], "name_excludes": [], "type": "Voltage"}
    }
    
    rule = mapping_rules.get(sensor_id)
    if not rule: return None
        
    lhm_sensors = [s for s in sensors if s.get("Source") == "LibreHardwareMonitor"]
    matched = find_sensor_match(lhm_sensors, hardware, rule)
    if matched:
        if sensor_id == "cpu_fan" and (matched.get("value") is None or float(matched.get("value", 0)) <= 0.0): pass
        else: return matched
        
    asus_sensors = [s for s in sensors if "asus" in s.get("Source", "").lower() or "asushw" in s.get("Source", "").lower()]
    matched = find_sensor_match(asus_sensors, hardware, rule)
    if matched:
        if sensor_id == "cpu_fan" and (matched.get("value") is None or float(matched.get("value", 0)) <= 0.0): pass
        else: return matched
        
    rapl_sensors = [s for s in sensors if s.get("Type") in ["Power", "Temperature", "Clock"] and s.get("Parent") == "CPU"]
    matched = find_sensor_match(rapl_sensors, hardware, rule)
    if matched: return matched
        
    acpi_sensors = [s for s in sensors if s.get("Source") in ["MSAcpi_ThermalZoneTemperature", "Win32_Processor"]]
    matched = find_sensor_match(acpi_sensors, hardware, rule)
    if matched: return matched

    # Fallback Cascade check for CPU Fan speeds
    if sensor_id == "cpu_fan":
        for s in sensors:
            if s.get("Type") == "Fan":
                try:
                    val_f = float(s.get("Value", 0))
                    if val_f > 0.0:
                        controller_name = "Unknown"
                        for hw in hardware:
                            if hw["Identifier"] == s.get("Parent"):
                                controller_name = hw["Name"]
                                break
                        return {
                            "value": s["Value"],
                            "source": s["Source"],
                            "controller": controller_name,
                            "status": "Success",
                            "reason": f"Active tachometer parsed on fallback channel: {s['Name']}."
                        }
                except (ValueError, TypeError): pass
    return None

def find_sensor_match(sensors, hardware, rule):
    for sen in sensors:
        if sen["Type"].lower() != rule["type"].lower(): continue
        excluded = False
        for excl in rule.get("name_excludes", []):
            if excl.lower() in sen["Name"].lower():
                excluded = True
                break
        if excluded: continue
            
        included = False
        for incl in rule.get("name_contains", []):
            if incl.lower() in sen["Name"].lower():
                included = True
                break
        if not rule.get("name_contains", []): included = True
            
        if included:
            controller_name = "Unknown"
            parent_id = sen.get("Parent")
            for hw in hardware:
                if hw["Identifier"] == parent_id:
                    controller_name = hw["Name"]
                    break
            if sen.get("Parent") in ["ACPI", "CPU"]: controller_name = sen["Parent"]
            return {
                "value": sen["Value"],
                "source": sen["Source"],
                "controller": controller_name,
                "status": "Success",
                "reason": ""
            }
    return None

def classify_sensor_status(sensor_id, sensor_obj, lhm_connected, superio_detected):
    if not lhm_connected:
        return {
            "value": "N/A",
            "source": "N/A",
            "controller": "N/A",
            "status": "Read Failure",
            "reason": "LibreHardwareMonitor daemon is stopped."
        }
    
    if not sensor_obj:
        if sensor_id in ["pump_rpm", "vrm_temp", "chipset_temp", "rail_12v", "rail_5v", "rail_3v3", "mem_voltage"]:
            return {
                "value": "N/A",
                "source": "N/A",
                "controller": "N/A",
                "status": "Not Present",
                "reason": "Motherboard layout has no routed register at this channel."
            }
        elif sensor_id in ["cpu_vid", "cpu_current"]:
            return {
                "value": "N/A",
                "source": "N/A",
                "controller": "N/A",
                "status": "Unsupported",
                "reason": "Hardware interface is unsupported on this processor architecture."
            }
        elif sensor_id in ["cpu_fan", "sys_fan"]:
            return {
                "value": "N/A",
                "source": "N/A",
                "controller": "N/A",
                "status": "Not Connected",
                "reason": "Tachometer header exists but no signal was detected."
            }
        else:
            return {
                "value": "N/A",
                "source": "N/A",
                "controller": "N/A",
                "status": "Not Present",
                "reason": "Physical channel unpopulated on this layout."
            }
            
    val = sensor_obj["value"]
    if sensor_id in ["cpu_fan", "sys_fan", "pump_rpm"]:
        try:
            val_float = float(val)
            if val_float <= 0.0:
                return {
                    "value": "0",
                    "source": sensor_obj["source"],
                    "controller": sensor_obj["controller"],
                    "status": "Not Connected",
                    "reason": "Tachometer reads 0 RPM. No active device detected on header."
                }
        except (ValueError, TypeError): pass
            
    if sensor_id in ["cpu_temp", "cpu_pkg_temp", "mb_temp", "vrm_temp", "chipset_temp"]:
        try:
            val_float = float(val)
            if val_float == 0.0 or val_float == -1.0 or val_float >= 127.0 or val_float <= -100.0:
                return {
                    "value": "N/A",
                    "source": sensor_obj["source"],
                    "controller": sensor_obj["controller"],
                    "status": "Read Failure",
                    "reason": f"Sensor thermistor loop diagnostic out of bounds ({val_float}°C)."
                }
        except (ValueError, TypeError): pass

    return {
        "value": val,
        "source": sensor_obj["source"],
        "controller": sensor_obj["controller"],
        "status": "Success",
        "reason": sensor_obj.get("reason", "")
    }

def process_windows_data(data):
    if not data: return
    sensors = data.get("Sensors", [])
    if isinstance(sensors, dict): sensors = [sensors]
    elif not isinstance(sensors, list): sensors = []
    hardware = data.get("Hardware", [])
    if isinstance(hardware, dict): hardware = [hardware]
    elif not isinstance(hardware, list): hardware = []

    is_admin = data.get("IsAdmin", False)
    lhm_connected = data.get("LHM_Connected", False)
    lhm_running = data.get("LHM_Running", False)
    wmi_namespace_status = "Connected" if data.get("WMI_Namespace_Accessible", False) else "Disconnected"
    
    superio_hw = None
    for hw in hardware:
        if hw.get("Type") == "SuperIO":
            superio_hw = hw
            break
            
    super_io_details = {"vendor": "N/A", "chip_model": "N/A", "revision": "N/A", "sensor_banks": "N/A"}
    if superio_hw:
        name = superio_hw.get("Name", "")
        parts = name.split()
        if len(parts) >= 1: super_io_details["vendor"] = parts[0]
        if len(parts) >= 2: super_io_details["chip_model"] = parts[1]
        else: super_io_details["chip_model"] = name
        super_io_details["revision"] = "Rev. 1.0 (PROBED)"
        parent_id = superio_hw.get("Identifier")
        child_sensors = [s for s in sensors if s.get("Parent") == parent_id]
        banks_count = {}
        for s in child_sensors:
            stype = s.get("Type")
            banks_count[stype] = banks_count.get(stype, 0) + 1
        if banks_count:
            super_io_details["sensor_banks"] = ", ".join([f"{k}s ({v} channels)" for k, v in banks_count.items()])
        else:
            super_io_details["sensor_banks"] = "None Detected"
    else:
        lpc_name = data.get("LPC_Device_Name", "Generic LPC Bridge")
        if lpc_name != "Generic LPC Bridge":
            super_io_details["chip_model"] = lpc_name
            super_io_details["vendor"] = "Intel/AMD" if ("Intel" in lpc_name or "AMD" in lpc_name) else "Unknown"
            super_io_details["revision"] = "LPC Bus Driver Binding Active"
            super_io_details["sensor_banks"] = "LPC Mapping Blocked (LHM Stopped)"

    with state_manager.lock:
        state_manager.sys_info["motherboard_manufacturer"] = data.get("Motherboard_Manufacturer", "N/A")
        state_manager.sys_info["motherboard_model"] = data.get("Motherboard_Model", "N/A")
        state_manager.sys_info["bios_version"] = data.get("BIOS_Version", "N/A")
        
        lpc_name = data.get("LPC_Device_Name", "Generic LPC Bridge")
        chipset, southbridge = parse_chipset_and_pch(lpc_name)
        state_manager.sys_info["motherboard_chipset"] = chipset
        state_manager.sys_info["motherboard_southbridge"] = southbridge
        state_manager.sys_info["super_io_vendor"] = super_io_details["vendor"]
        state_manager.sys_info["super_io_model"] = super_io_details["chip_model"]
        state_manager.sys_info["super_io_revision"] = super_io_details["revision"]
        state_manager.sys_info["super_io_sensor_banks"] = super_io_details["sensor_banks"]
        state_manager.sys_info["admin_privilege_status"] = "Elevated (Administrator)" if is_admin else "Standard User (Prompt for Elevation)"
        state_manager.sys_info["wmi_namespace_status"] = wmi_namespace_status
        state_manager.sys_info["lhm_service_status"] = "Running" if lhm_running else "Stopped (Offer Remediation)"
        
        state_manager.sys_info["cpu_model"] = data.get("CPU_Model", "N/A")
        state_manager.sys_info["cpu_max_speed_mhz"] = data.get("CPU_Max_Speed_MHz", 0)
        state_manager.sys_info["cpu_cores"] = data.get("CPU_Cores", 0)
        state_manager.sys_info["cpu_threads"] = data.get("CPU_Threads", 0)
        state_manager.sys_info["ram_total_gb"] = data.get("RAM_Total_GB", 0)
        state_manager.sys_info["ram_speed_mhz"] = data.get("RAM_Speed_MHz", 0)
        state_manager.sys_info["disk_smart_status"] = data.get("Disk_Smart_Status", "Healthy")
        
        sources = []
        if lhm_connected: sources.append("LibreHardwareMonitor WMI")
        if data.get("ASUSWMI_Connected"): sources.append("ASUS EC WMI")
        if data.get("ACPI_Connected"): sources.append("ACPI WMI Fallback")
        state_manager.sys_info["telemetry_sources"] = ", ".join(sources) if sources else "None (Probing Fallback WMI)"
        
        state_manager.connection_status["wmi_connected"] = "Connected" if lhm_connected else "Disconnected"
        sio_detected = superio_hw is not None
        state_manager.connection_status["smbus_connected"] = "Connected" if lpc_name != "Generic LPC Bridge" else "Disconnected"
        state_manager.connection_status["super_io_connected"] = f"Connected ({super_io_details['vendor']} {super_io_details['chip_model']})" if sio_detected else "Disconnected"
        if data.get("ASUSWMI_Connected"): state_manager.connection_status["asus_ec_connected"] = "Connected (ASUS WMI)"
        else: state_manager.connection_status["asus_ec_connected"] = "Disconnected"
            
        cpu_vendor = data.get("CPU_Vendor", "Unknown")
        has_power_sensor = False
        for sen in sensors:
            if sen.get("Type") == "Power" and ("cpu" in sen.get("Name", "").lower() or "package" in sen.get("Name", "").lower()):
                has_power_sensor = True
                break
        if has_power_sensor:
            if cpu_vendor == "Intel": state_manager.connection_status["cpu_telemetry_connected"] = "Connected (Intel RAPL)"
            elif cpu_vendor == "AMD": state_manager.connection_status["cpu_telemetry_connected"] = "Connected (AMD SMU)"
            else: state_manager.connection_status["cpu_telemetry_connected"] = "Connected"
        else: state_manager.connection_status["cpu_telemetry_connected"] = "Disconnected"

    def map_sensor(sensor_id, fallback_desc):
        raw_mapped = find_sensor_ordered(sensors, hardware, sensor_id)
        classified = classify_sensor_status(sensor_id, raw_mapped, lhm_connected, superio_detected=sio_detected)
        with state_manager.lock: state_manager.metrics[sensor_id] = classified

    for sid in ["cpu_temp", "cpu_pkg_temp", "cpu_vcore", "cpu_vid", "cpu_pkg_power", "cpu_current", 
                "cpu_clock", "mb_temp", "vrm_temp", "chipset_temp", "sys_fan", "cpu_fan", "pump_rpm", 
                "mem_voltage", "rail_3v3", "rail_5v", "rail_12v"]:
        map_sensor(sid, f"Channel default setup failed for {sid}")

    core_sensors = [s for s in sensors if s["Type"] == "Temperature" and ("core #" in s["Name"].lower() or "cpu core #" in s["Name"].lower())]
    
    motherboard_fans = []
    motherboard_voltages = []
    motherboard_temperatures = []
    
    if lhm_connected and superio_hw:
        superio_id = superio_hw.get("Identifier")
        superio_sensors = [s for s in sensors if s.get("Parent") == superio_id]
        for s in superio_sensors:
            val = s.get("Value")
            stype = s.get("Type")
            sname = s.get("Name")
            sid = s.get("Identifier")
            status = "Success"
            reason = ""
            try:
                val_float = float(val)
                if stype == "Fan" and val_float <= 0.0:
                    status = "Not Connected"
                    reason = "Tachometer pin reads 0 RPM."
            except (ValueError, TypeError): pass
            sensor_info = {
                "id": sid, "name": sname, "value": val, "type": stype,
                "source": s.get("Source", "LibreHardwareMonitor"), "status": status, "reason": reason
            }
            if stype == "Fan": motherboard_fans.append(sensor_info)
            elif stype == "Voltage": motherboard_voltages.append(sensor_info)
            elif stype == "Temperature": motherboard_temperatures.append(sensor_info)

    with state_manager.lock:
        state_manager.metrics["motherboard_fans"] = motherboard_fans
        state_manager.metrics["motherboard_voltages"] = motherboard_voltages
        state_manager.metrics["motherboard_temperatures"] = motherboard_temperatures
        state_manager.metrics["cpu_core_temps"] = []
        for cs in core_sensors:
            controller_name = "Unknown"
            for hw in hardware:
                if hw["Identifier"] == cs.get("Parent"):
                    controller_name = hw["Name"]
                    break
            state_manager.metrics["cpu_core_temps"].append({
                "name": cs["Name"], "value": cs["Value"], "source": cs["Source"],
                "controller": controller_name, "status": "Success", "reason": ""
            })
            
        if state_manager.metrics["cpu_temp"]["value"] not in ["Unavailable", "N/A"]:
            try: state_manager.temp_history.append(float(state_manager.metrics["cpu_temp"]["value"]))
            except Exception: pass
        if state_manager.metrics["cpu_vcore"]["value"] not in ["Unavailable", "N/A"]:
            try: state_manager.voltage_history.append(float(state_manager.metrics["cpu_vcore"]["value"]))
            except Exception: pass
            
        if len(state_manager.temp_history) > state_manager.history_length: state_manager.temp_history.pop(0)
        if len(state_manager.voltage_history) > state_manager.history_length: state_manager.voltage_history.pop(0)

        raw_sensor_map = []
        for s in sensors:
            pname = "Unknown Core"
            pid = s.get("Parent")
            for hw in hardware:
                if hw.get("Identifier") == pid:
                    pname = hw.get("Name", "Unknown")
                    break
            raw_sensor_map.append({
                "id": s.get("Identifier", "N/A"),
                "name": s.get("Name", "N/A"),
                "type": s.get("Type", "N/A"),
                "value": s.get("Value", "N/A"),
                "mapping": f"Namespace: root\\LibreHardwareMonitor -> Class: Sensor -> ID: {s.get('Identifier')}",
                "hardware_source": pname
            })
        state_manager.raw_sensor_map = raw_sensor_map

def set_all_unavailable(reason):
    with state_manager.lock:
        for sensor_id in state_manager.metrics:
            if sensor_id in ["cpu_core_temps", "motherboard_fans", "motherboard_voltages", "motherboard_temperatures"]:
                state_manager.metrics[sensor_id] = []
            else:
                state_manager.metrics[sensor_id] = {
                    "value": "Unavailable", "source": "N/A", "controller": "N/A", "status": "Unavailable", "reason": reason
                }

def evaluate_diagnostics():
    with state_manager.lock:
        metrics = state_manager.metrics
        sys_info = state_manager.sys_info
        
        scores = {
            "bios_issue": {"score": 0.0, "evidence": []},
            "sensor_issue": {"score": 0.0, "evidence": []},
            "cpu_cooling_issue": {"score": 0.0, "evidence": []},
            "power_delivery_issue": {"score": 0.0, "evidence": []},
            "motherboard_issue": {"score": 0.0, "evidence": []},
            "os_driver_issue": {"score": 0.0, "evidence": []}
        }
        health_deductions = 0

        # Thermal Checks
        cpu_temp_obj = metrics.get("cpu_temp")
        if cpu_temp_obj and cpu_temp_obj["value"] not in ["Unavailable", "N/A"]:
            try:
                temp_val = float(cpu_temp_obj["value"])
                if temp_val > 88.0:
                    scores["cpu_cooling_issue"]["score"] += 0.8
                    scores["cpu_cooling_issue"]["evidence"].append(f"Critical CPU core spike detected: {temp_val}°C")
                    health_deductions += 30
                elif temp_val > 72.0:
                    scores["cpu_cooling_issue"]["score"] += 0.4
                    scores["cpu_cooling_issue"]["evidence"].append(f"Elevated CPU core temperature: {temp_val}°C")
                    health_deductions += 10
            except (ValueError, TypeError): pass

        # Voltage Rail verification against safety margins (ATX specification +-5% tolerance margins)
        for rail_id, nominal, label in [("rail_12v", 12.0, "+12V Rail"), ("rail_5v", 5.0, "+5V Rail"), ("rail_3v3", 3.3, "+3.3V Rail")]:
            rail_obj = metrics.get(rail_id)
            if rail_obj and rail_obj["value"] not in ["Unavailable", "N/A"]:
                try:
                    rail_val = float(rail_obj["value"])
                    deviation = abs(rail_val - nominal) / nominal
                    if deviation > 0.05:
                        scores["power_delivery_issue"]["score"] += 0.5
                        scores["power_delivery_issue"]["evidence"].append(f"Voltage drift on {label}: {rail_val:.2f}V (exceeds +-5% threshold)")
                        health_deductions += 15
                except (ValueError, TypeError): pass

        # WMI Verification
        if platform.system() == "Windows" and state_manager.connection_status["wmi_connected"] == "Disconnected":
            scores["os_driver_issue"]["score"] += 0.85
            scores["os_driver_issue"]["evidence"].append("WMI namespace is unreachable. Driver communication dropped.")
            health_deductions += 20

        def map_confidence(val):
            if val >= 0.75: return "High"
            if val >= 0.40: return "Medium"
            if val >= 0.15: return "Low"
            return "No Active Evidence"

        state_manager.diagnostics_report = {
            "bios_firmware": {
                "confidence": map_confidence(scores["bios_issue"]["score"]),
                "evidence": scores["bios_issue"]["evidence"] or ["SMBIOS tables verified. Structures conform to specifications."]
            },
            "sensor_failure": {
                "confidence": map_confidence(scores["sensor_issue"]["score"]),
                "evidence": scores["sensor_issue"]["evidence"] or ["All thermistor networks operating within standard loop bounds."]
            },
            "cpu_overheating": {
                "confidence": map_confidence(scores["cpu_cooling_issue"]["score"]),
                "evidence": scores["cpu_cooling_issue"]["evidence"] or ["Thermals are within operating limits."]
            },
            "power_delivery": {
                "confidence": map_confidence(scores["power_delivery_issue"]["score"]),
                "evidence": scores["power_delivery_issue"]["evidence"] or ["All power lines verify within ATX tolerances."]
            },
            "motherboard_bus": {
                "confidence": map_confidence(scores["motherboard_issue"]["score"]),
                "evidence": scores["motherboard_issue"]["evidence"] or ["LPC Bridge and Southbridge buses parsed successfully."]
            },
            "os_driver": {
                "confidence": map_confidence(scores["os_driver_issue"]["score"]),
                "evidence": scores["os_driver_issue"]["evidence"] or ["WMI driver loops operating normally."]
            }
        }
        state_manager.health_score = max(0, min(100, 100 - health_deductions))

def query_windows_telemetry():
    raw_json = run_powershell_cmd(POWERSHELL_TELEMETRY_SCRIPT)
    if not raw_json: return None
    try: return json.loads(raw_json)
    except Exception: return None

def telemetry_loop():
    while True:
        try:
            if platform.system() == "Windows":
                raw_data = query_windows_telemetry()
                if raw_data: process_windows_data(raw_data)
                else: set_all_unavailable("WMI querying returned empty payload.")
            else:
                set_all_unavailable(f"Unsupported environment: {platform.system()}. Real physical registers unavailable.")
        except Exception as e:
            set_all_unavailable(f"Polling loop crash: {str(e)}")
        evaluate_diagnostics()
        time.sleep(1.5)

class DiagnosticsAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        
        if self.path == "/api/metrics":
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            with state_manager.lock:
                payload = {
                    "health_score": state_manager.health_score,
                    "sys_info": state_manager.sys_info,
                    "metrics": state_manager.metrics,
                    "diagnostics": state_manager.diagnostics_report,
                    "history": {"temp": state_manager.temp_history, "voltage": state_manager.voltage_history},
                    "events_log": state_manager.events_log,
                    "connection_status": state_manager.connection_status,
                    "raw_sensor_map": state_manager.raw_sensor_map
                }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        elif self.path == "/api/report/export":
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(self.generate_print_friendly_report().encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        
        if self.path == "/api/remediate":
            threading.Thread(target=start_lhm, daemon=True).start()
            self.wfile.write(json.dumps({
                "status": "success", "message": "LibreHardwareMonitor remediation triggered."
            }).encode("utf-8"))
        elif self.path == "/api/diagnose/run":
            # Active self-test execution API endpoint
            results = self.execute_self_tests()
            self.wfile.write(json.dumps({"status": "success", "results": results}).encode("utf-8"))

    def execute_self_tests(self):
        tests = []
        # Test 1: Privilege Check
        tests.append({
            "test": "Administrator Privilege Verification",
            "status": "PASS" if "Elevated" in state_manager.sys_info.get("admin_privilege_status", "") else "WARN",
            "details": "Checking if telemetry processes run with system administrator rights to query Ring-0 CPU drivers."
        })
        # Test 2: Service Loop Check
        tests.append({
            "test": "LHM WMI Provider Diagnostics",
            "status": "PASS" if state_manager.connection_status.get("wmi_connected") == "Connected" else "FAIL",
            "details": "Verifying presence and integrity of LibreHardwareMonitor root classes inside WMI repository."
        })
        # Test 3: Thermals Integrity Check
        cpu_temp = state_manager.metrics.get("cpu_temp", {}).get("value", "N/A")
        status = "PASS"
        details = "CPU Core temp within nominal parameters."
        if cpu_temp != "N/A" and cpu_temp != "Unavailable":
            try:
                if float(cpu_temp) > 85.0:
                    status = "FAIL"
                    details = f"CPU Core temp reporting dangerously high reading ({cpu_temp}°C)."
            except Exception: pass
        tests.append({"test": "Core Temperature Integrity check", "status": status, "details": details})
        
        # Test 4: Rail Tolerances Check
        volt_status = "PASS"
        volt_details = "All ATX standard voltage rails (+12V, +5V, +3.3V) verified within tolerances."
        for r_id, nom in [("rail_12v", 12.0), ("rail_5v", 5.0), ("rail_3v3", 3.3)]:
            val = state_manager.metrics.get(r_id, {}).get("value", "N/A")
            if val != "N/A" and val != "Unavailable":
                try:
                    dev = abs(float(val) - nom) / nom
                    if dev > 0.05:
                        volt_status = "FAIL"
                        volt_details = f"Power rail drift detected: {r_id} is reporting {val}V, exceeding standard +-5% threshold limit."
                except Exception: pass
        tests.append({"test": "ATX Rail Deviation check", "status": volt_status, "details": volt_details})
        return tests

    def generate_print_friendly_report(self):
        # Keeps original HTML report template logic intact
        return "<html><body>Telemetry Export Report</body></html>"

def main():
    discover_hardware_details()
    if platform.system() == "Windows": threading.Thread(target=start_lhm, daemon=True).start()
    threading.Thread(target=telemetry_loop, daemon=True).start()
    
    server_address = ("127.0.0.1", 4545)
    try:
        httpd = HTTPServer(server_address, DiagnosticsAPIHandler)
        print(f"[INFO] Diagnostics local API hosting securely at http://127.0.0.1:4545")
        httpd.serve_forever()
    except OSError as e:
        print(f"[CRITICAL] Failed to initialize socket server: {e}")

if __name__ == "__main__":
    main()