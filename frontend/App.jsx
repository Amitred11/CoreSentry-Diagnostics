const { useState, useEffect, useRef } = React;

const SENSOR_META = {
  cpu_temp: { label: "CPU Temperature", unit: "°C", category: "Thermals" },
  cpu_pkg_temp: { label: "CPU Package Temperature", unit: "°C", category: "Thermals" },
  cpu_vcore: { label: "CPU Vcore Voltage", unit: " V", category: "Voltages" },
  cpu_vid: { label: "CPU VID", unit: " V", category: "Voltages" },
  cpu_pkg_power: { label: "CPU Package Power", unit: " W", category: "Power" },
  cpu_current: { label: "CPU Current Draw", unit: " A", category: "Current" },
  cpu_clock: { label: "CPU Clock Speed", unit: " MHz", category: "Clocks" },
  mb_temp: { label: "Motherboard Temp", unit: "°C", category: "Thermals" },
  vrm_temp: { label: "VRM Temperature", unit: "°C", category: "Thermals" },
  chipset_temp: { label: "Chipset Temp (PCH)", unit: "°C", category: "Thermals" },
  sys_fan: { label: "System Fan", unit: " RPM", category: "Fans" },
  cpu_fan: { label: "CPU Fan", unit: " RPM", category: "Fans" },
  pump_rpm: { label: "AIO/Water Pump Speed", unit: " RPM", category: "Fans" },
  mem_voltage: { label: "Memory Voltage (VDD)", unit: " V", category: "Voltages" },
  rail_3v3: { label: "+3.3V Power Rail", unit: " V", category: "Voltages" },
  rail_5v: { label: "+5V Power Rail", unit: " V", category: "Voltages" },
  rail_12v: { label: "+12V Power Rail", unit: " V", category: "Voltages" }
};

const SENSORS_LIST = [
  "cpu_temp", "cpu_pkg_temp", "cpu_vcore", "cpu_vid",
  "cpu_pkg_power", "cpu_current", "cpu_clock", "mb_temp",
  "vrm_temp", "chipset_temp", "sys_fan", "cpu_fan",
  "pump_rpm", "mem_voltage", "rail_3v3", "rail_5v", "rail_12v"
];

const TelemetryGraph = ({ data, maxVal, unit, strokeColor, label }) => {
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      setWidth(rect.width);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width * window.devicePixelRatio;
    canvas.height = 100 * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = width;
    const h = 100;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (data.length < 2) return;

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;

    const step = w / (data.length - 1);
    data.forEach((val, index) => {
      const normalizedY = h - (val / maxVal) * (h - 20) - 10;
      const x = index * step;
      if (index === 0) ctx.moveTo(x, normalizedY);
      else ctx.lineTo(x, normalizedY);
    });
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, strokeColor + '20');
    grad.addColorStop(1, strokeColor + '00');
    ctx.fillStyle = grad;
    ctx.fill();

  }, [data, maxVal, strokeColor, width]);

  const latestVal = data[data.length - 1] ?? 0;

  return (
    <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-lg transition duration-200 hover:border-slate-700">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">{label}</span>
        <span className="text-xs font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
          {latestVal.toFixed(2)}{unit}
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full h-24 rounded-lg border border-slate-950" />
    </div>
  );
};

function App() {
  const [telemetry, setTelemetry] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [remediating, setRemediating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Specs Drawer on Mobile Layouts
  const [specsOpen, setSpecsOpen] = useState(false);

  // Active Hardware Self-Test Suite States
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState([]);
  const [testLog, setTestLog] = useState([]);

  // Live Fan profile curve visualiser
  const [fanProfile, setFanProfile] = useState('Standard Profile');

  const fetchTelemetry = async () => {
    try {
      const res = await fetch('http://127.0.0.1:4545/api/metrics');
      if (!res.ok) throw new Error(`HTTP Status: ${res.status}`);
      const data = await res.json();
      setTelemetry(data);
      setError(null);
    } catch (e) {
      setError(`Telemetry connection down. Check if background service is running on Port 4545.`);
    }
  };

  const triggerRemediation = async () => {
    setRemediating(true);
    try {
      const res = await fetch('http://127.0.0.1:4545/api/remediate', { method: 'POST' });
      const data = await res.json();
      alert(data.message);
    } catch (e) {
      alert(`Remediation Error: ${e.message}`);
    } finally {
      setRemediating(false);
      fetchTelemetry();
    }
  };

  const executeSelfTests = async () => {
    setTesting(true);
    setTestLog([]);
    setTestResults([]);
    
    const logs = [
      "Initializing Motherboard integrity verification routine...",
      "Parsing SMBIOS parameters tables and searching structures...",
      "Inspecting elevated access keys for low-level register bindings...",
      "Evaluating CPU temperature and fan tachometer loops...",
      "Querying ATX +12V, +5V, +3.3V power rails for limits...",
      "Compiling complete diagnostics hardware state report..."
    ];

    for (let i = 0; i < logs.length; i++) {
      await new Promise(r => setTimeout(r, 600));
      setTestLog(prev => [...prev, `[INFO] ${logs[i]}`]);
    }

    try {
      const res = await fetch('http://127.0.0.1:4545/api/diagnose/run', { method: 'POST' });
      const data = await res.json();
      setTestResults(data.results);
      setTestLog(prev => [...prev, "[SUCCESS] Full diagnostics integrity suite executed successfully."]);
    } catch (e) {
      setTestLog(prev => [...prev, `[ERROR] Verification tests crashed: ${e.message}`]);
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1500);
    return () => clearInterval(interval);
  }, []);

  if (error || !telemetry) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mb-6"></div>
        <div className="text-cyan-400 font-mono text-lg mb-2 uppercase">Handshaking telemetry...</div>
        <p className="text-slate-400 text-sm max-w-lg bg-slate-900 border border-slate-800 p-5 rounded-xl leading-relaxed font-mono shadow-xl">
          {error || "Parsing active WMI structures and allocating layout variables."}
        </p>
      </div>
    );
  }

  const { sys_info, metrics, diagnostics, history, events_log, health_score, connection_status } = telemetry;
  const raw_sensor_map = telemetry.raw_sensor_map || [];
  const filteredSensors = raw_sensor_map.filter(s => 
    s.name.toLowerCase().includes(searchTerm) || 
    s.id.toLowerCase().includes(searchTerm) || 
    s.hardware_source.toLowerCase().includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-20 lg:pb-0">
      
      {/* Dynamic Header */}
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-md sm:text-lg font-bold tracking-tight text-white uppercase font-mono">
              Expert diagnostics telemetry
            </h1>
            <span className="hidden sm:inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Direct WMI Bus
            </span>
          </div>
          <p className="text-[10px] sm:text-xs text-slate-400 font-mono mt-0.5">Local Server Port: 4545</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile Specifications Button Toggle */}
          <button 
            onClick={() => setSpecsOpen(!specsOpen)}
            className="lg:hidden px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300"
          >
            📋 Platform Specs
          </button>
          <a 
            href="http://127.0.0.1:4545/api/report/export" 
            target="_blank" 
            className="hidden sm:flex px-4 py-2 bg-cyan-600 hover:bg-cyan-500 active:scale-95 transition rounded-lg text-xs font-bold text-white items-center gap-2 font-mono shadow-md"
          >
            Export HTML Report
          </a>
        </div>
      </header>

      {/* Slide-out Panel on Mobile for specs */}
      {specsOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 lg:hidden flex justify-end">
          <div className="w-80 bg-slate-900 border-l border-slate-800 p-5 flex flex-col gap-4 overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <span className="font-bold text-white font-mono text-sm uppercase">Platform specs</span>
              <button onClick={() => setSpecsOpen(false)} className="text-slate-400 hover:text-white font-mono font-bold text-sm">✕ Close</button>
            </div>
            {/* Specs Block */}
            <div className="flex flex-col gap-4 font-mono text-xs text-slate-300">
              <div>
                <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">CPU model</span>
                <span className="text-white font-semibold truncate block">{sys_info.cpu_model}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Motherboard specs</span>
                <span className="text-white font-semibold block">{sys_info.motherboard_manufacturer} {sys_info.motherboard_model}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Motherboard Chipset</span>
                  <span className="text-cyan-400 font-semibold truncate block">{sys_info.motherboard_chipset}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Southbridge</span>
                  <span className="text-cyan-400 font-semibold truncate block">{sys_info.motherboard_southbridge}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Super I/O model</span>
                  <span className="text-white font-semibold truncate block">{sys_info.super_io_model}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Super I/O revision</span>
                  <span className="text-white font-semibold truncate block">{sys_info.super_io_revision}</span>
                </div>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5 uppercase text-[10px]">Active telemetries</span>
                <span className="text-white font-semibold truncate block">{sys_info.telemetry_sources}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Container Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 sm:p-6">
        
        {/* Desktop Side Panel navigation */}
        <div className="hidden lg:flex lg:col-span-3 flex-col gap-5">
          {/* Health Index gauge widget */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 text-center flex flex-col justify-center items-center shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-emerald-500 to-rose-500 opacity-20"></div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-mono block">overall platform health</span>
            <div className="relative flex items-center justify-center w-28 h-28 rounded-full border-4 border-slate-800/80 shadow-inner">
              <div className="text-3xl font-extrabold font-mono text-white">
                <span className={health_score > 80 ? "text-emerald-400" : health_score > 50 ? "text-amber-400" : "text-rose-500"}>
                  {health_score}
                </span>
                <span className="text-slate-500 text-sm">/100</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 mt-4 leading-relaxed">
              {health_score > 80 ? "Physical Core registers are fully stable." : "Physical telemetry anomalies identified."}
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-2 flex flex-col gap-1 font-mono shadow-md">
            {[
              { id: 'dashboard', label: '📊 Sensor Dashboard' },
              { id: 'diagnostics', label: '🧠 Expert Diagnostics' },
              { id: 'selftest', label: '🛡️ Self-Test utility' },
              { id: 'raw_telemetry', label: '🔌 Raw registers' }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-3 rounded-xl text-xs font-semibold tracking-wide transition ${
                  activeTab === tab.id ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/20' : 'hover:bg-slate-800/50 text-slate-400 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Desktop Platforms inventory Specs */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg flex-1">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 pb-2 border-b border-slate-800/60 font-mono">Platform Specs</h3>
            <div className="flex flex-col gap-4 font-mono text-[11px] text-slate-300">
              <div>
                <span className="text-slate-500 block mb-0.5">CPU model</span>
                <span className="text-white font-semibold truncate block" title={sys_info.cpu_model}>{sys_info.cpu_model}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block mb-0.5">cores/threads</span>
                  <span className="text-white font-semibold">{sys_info.cpu_cores}C / {sys_info.cpu_threads}T</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5">clock base</span>
                  <span className="text-white font-semibold">{sys_info.cpu_max_speed_mhz} MHz</span>
                </div>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Motherboard model</span>
                <span className="text-white font-semibold truncate block">{sys_info.motherboard_manufacturer} {sys_info.motherboard_model}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block mb-0.5">chipset</span>
                  <span className="text-cyan-400 font-semibold truncate block">{sys_info.motherboard_chipset}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5">southbridge</span>
                  <span className="text-cyan-400 font-semibold truncate block">{sys_info.motherboard_southbridge}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block mb-0.5">Super I/O model</span>
                  <span className="text-white font-semibold truncate block">{sys_info.super_io_model}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5">Super I/O rev</span>
                  <span className="text-white font-semibold truncate block">{sys_info.super_io_revision}</span>
                </div>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">sources</span>
                <span className="text-white font-semibold truncate block">{sys_info.telemetry_sources}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Workspace Panel */}
        <div className="col-span-1 lg:col-span-9 flex flex-col gap-6">
          
          {activeTab === 'dashboard' && (
            <div className="flex flex-col gap-6">
              
              {/* Automated Driver Remediation Widget */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-lg">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Service Daemon & Self-Remediation Plan</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Tracks dynamic WMI publishing pools, elevated kernel drivers, and connection states.
                    </p>
                  </div>
                  <button 
                    onClick={triggerRemediation}
                    disabled={remediating}
                    className="w-full md:w-auto px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 active:scale-95 transition text-white text-xs font-bold rounded-lg shadow-md font-mono disabled:opacity-50"
                  >
                    {remediating ? "Configuring..." : "⚡ Force Self-Remediation"}
                  </button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs mt-1">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">LHM Core Service</span>
                    <span className={`font-bold block mt-1 ${sys_info.lhm_service_status === 'Running' ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                      {sys_info.lhm_service_status}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Privilege Escalation</span>
                    <span className={`font-bold block mt-1 ${sys_info.admin_privilege_status.includes('Elevated') ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {sys_info.admin_privilege_status}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">WMI Namespace Access</span>
                    <span className={`font-bold block mt-1 ${sys_info.wmi_namespace_status === 'Connected' ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {sys_info.wmi_namespace_status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Hardware Connection Interfaces status layout */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 font-mono">Probed Hardware Interfaces</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { id: 'asus_ec_connected', label: 'ASUS EC' },
                    { id: 'smbus_connected', label: 'SMBus Bridge' },
                    { id: 'super_io_connected', label: 'Super I/O' },
                    { id: 'cpu_telemetry_connected', label: 'CPU registers' },
                    { id: 'wmi_connected', label: 'WMI Transport' }
                  ].map(iface => {
                    const status = connection_status[iface.id];
                    const active = status.includes('Connected');
                    return (
                      <div key={iface.id} className="bg-slate-950 border border-slate-900 rounded-xl p-3 flex flex-col justify-between h-20 shadow-inner">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-slate-600'}`}></span>
                          <span className="text-[10px] text-slate-500 font-bold uppercase font-mono">{iface.label}</span>
                        </div>
                        <div className="text-xs font-semibold text-slate-300 font-mono truncate block" title={status}>
                          {active ? status : 'Disconnected'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Quick featured Metrics Gauges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { id: 'cpu_temp', label: SENSOR_META.cpu_temp.label, unit: SENSOR_META.cpu_temp.unit, color: 'text-rose-400', border: 'hover:border-rose-800/40' },
                  { id: 'cpu_vcore', label: SENSOR_META.cpu_vcore.label, unit: SENSOR_META.cpu_vcore.unit, color: 'text-cyan-400', border: 'hover:border-cyan-800/40' },
                  { id: 'cpu_fan', label: SENSOR_META.cpu_fan.label, unit: SENSOR_META.cpu_fan.unit, color: 'text-emerald-400', border: 'hover:border-emerald-800/40' },
                  { id: 'cpu_pkg_power', label: SENSOR_META.cpu_pkg_power.label, unit: SENSOR_META.cpu_pkg_power.unit, color: 'text-amber-400', border: 'hover:border-amber-800/40' }
                ].map(gauge => {
                  const sensor = metrics[gauge.id];
                  if (!sensor) return null;
                  const isSuccess = sensor.status === "Success";
                  return (
                    <div key={gauge.id} className={`bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-28 shadow-lg transition duration-200 ${gauge.border}`}>
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">{gauge.label}</div>
                        <div className={`text-xl font-extrabold mt-1.5 font-mono ${isSuccess ? gauge.color : 'text-slate-500 text-sm'}`}>
                          {isSuccess ? `${parseFloat(sensor.value).toFixed(1)}${gauge.unit}` : sensor.status}
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-800/60 font-mono text-[9px] text-slate-500 flex justify-between">
                        <span>CTRL: {isSuccess ? sensor.controller : 'N/A'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Real-time Dynamic Canvas charts block */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TelemetryGraph 
                  data={history.temp} 
                  maxVal={110} 
                  unit="°C" 
                  strokeColor="#f43f5e" 
                  label="CPU Temperature History (60s)" 
                />
                <TelemetryGraph 
                  data={history.voltage} 
                  maxVal={1.65} 
                  unit="V" 
                  strokeColor="#06b6d4" 
                  label="CPU Core Vcore History (60s)" 
                />
              </div>

              {/* Dynamic Core Temperatures Progress widget */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Processor Thermal Diode Array</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Individual core hardware register temperatures.</p>
                  </div>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${
                    metrics.cpu_core_temps.length > 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {metrics.cpu_core_temps.length > 0 ? "Array online" : "Offline"}
                  </span>
                </div>

                {metrics.cpu_core_temps.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {metrics.cpu_core_temps.map((core, i) => {
                      const temp = parseFloat(core.value);
                      const pct = Math.min(100, Math.max(0, (temp / 100) * 100));
                      let barColor = "bg-emerald-500";
                      if (temp > 85) barColor = "bg-rose-500 animate-pulse";
                      else if (temp > 70) barColor = "bg-amber-500";
                      return (
                        <div key={i} className="bg-slate-950 border border-slate-900 rounded-xl p-3 flex flex-col justify-between shadow-inner">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-400 font-bold font-mono">{core.name}</span>
                            <span className="text-xs font-bold text-white font-mono">{temp.toFixed(1)}°C</span>
                          </div>
                          <div className="w-full bg-slate-900 h-1 rounded overflow-hidden mt-1.5">
                            <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 text-center text-slate-500 text-xs font-mono">
                    Processor core thermal indicators are unpopulated. Run system with elevated rights.
                  </div>
                )}
              </div>

              {/* ATX Voltage spec Margin Check Visualizer */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">ATX Voltage Tolerance Visualizer</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Validates +12V, +5V, and +3.3V ATX rail operations against standard industry ±5% limits.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                  {[
                    { id: "rail_12v", nominal: 12.0, label: "+12V Rail Limit" },
                    { id: "rail_5v", nominal: 5.0, label: "+5V Rail Limit" },
                    { id: "rail_3v3", nominal: 3.3, label: "+3.3V Rail Limit" }
                  ].map(rail => {
                    const sensor = metrics[rail.id];
                    if (!sensor || sensor.status !== "Success") {
                      return (
                        <div key={rail.id} className="bg-slate-950 border border-slate-900 p-4 rounded-xl text-center text-slate-600">
                          {rail.label} Inaccessible
                        </div>
                      );
                    }
                    const val = parseFloat(sensor.value);
                    const dev = ((val - rail.nominal) / rail.nominal) * 100;
                    const pctPos = Math.min(100, Math.max(0, 50 + (dev * 5))); // Scale deviation centered at 50%
                    
                    let statColor = "text-emerald-400";
                    let lineStyle = "bg-emerald-500";
                    if (Math.abs(dev) > 5.0) {
                      statColor = "text-rose-500 animate-pulse";
                      lineStyle = "bg-rose-500";
                    } else if (Math.abs(dev) > 2.5) {
                      statColor = "text-amber-500";
                      lineStyle = "bg-amber-500";
                    }

                    return (
                      <div key={rail.id} className="bg-slate-950 border border-slate-900 p-4 rounded-xl shadow-inner">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">{rail.label}</span>
                          <span className={`font-bold ${statColor}`}>{val.toFixed(2)}V ({dev > 0 ? '+' : ''}{dev.toFixed(1)}%)</span>
                        </div>
                        {/* Interactive Scale indicator */}
                        <div className="w-full bg-slate-900 h-2 rounded-full relative mt-3 border border-slate-800">
                          <div className="absolute top-0 bottom-0 left-[48%] right-[48%] bg-slate-800 z-0"></div> {/* Center target line */}
                          <div className={`h-full w-2 rounded-full absolute transition-all duration-300 ${lineStyle}`} style={{ left: `${pctPos}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[8px] text-slate-600 mt-1.5 font-bold uppercase">
                          <span>-5% Limit</span>
                          <span>Nominal</span>
                          <span>+5% Limit</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fan Curve Optimization Profiles Visualizer */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Tachometer Fan Curve Presets</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Visualizes profile curves mapped against thermal temperatures and tachometer limits.
                    </p>
                  </div>
                  <div className="flex gap-1.5 font-mono text-[10px] w-full sm:w-auto overflow-x-auto whitespace-nowrap">
                    {['Silent Profile', 'Standard Profile', 'Aggressive Cooling'].map(prof => (
                      <button 
                        key={prof} 
                        onClick={() => setFanProfile(prof)}
                        className={`px-2.5 py-1.5 rounded-lg border font-semibold ${fanProfile === prof ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                      >
                        {prof}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                  <div className="md:col-span-8 bg-slate-950 p-4 rounded-xl border border-slate-900 shadow-inner relative h-40">
                    {/* SVG Fan profile plot */}
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 100 40">
                      {/* Grid Lines */}
                      <line x1="0" y1="10" x2="100" y2="10" stroke="#1e293b" strokeWidth="0.2" />
                      <line x1="0" y1="20" x2="100" y2="20" stroke="#1e293b" strokeWidth="0.2" />
                      <line x1="0" y1="30" x2="100" y2="30" stroke="#1e293b" strokeWidth="0.2" />
                      
                      {/* Profile Paths */}
                      {fanProfile === 'Silent Profile' && (
                        <path d="M 0,38 Q 40,38 60,30 T 100,2" fill="none" stroke="#06b6d4" strokeWidth="0.8" />
                      )}
                      {fanProfile === 'Standard Profile' && (
                        <path d="M 0,35 Q 30,30 50,18 T 100,1" fill="none" stroke="#10b981" strokeWidth="0.8" />
                      )}
                      {fanProfile === 'Aggressive Cooling' && (
                        <path d="M 0,25 Q 20,15 40,8 T 100,0" fill="none" stroke="#f43f5e" strokeWidth="0.8" />
                      )}

                      {/* Live Flashing Intersection coordinate */}
                      {metrics.cpu_temp.status === "Success" && metrics.cpu_fan.status === "Success" && (
                        <circle cx={Math.min(100, Math.max(0, (parseFloat(metrics.cpu_temp.value) / 100) * 100))} cy={Math.min(40, Math.max(0, 40 - (parseFloat(metrics.cpu_fan.value) / 3000) * 40))} r="1.5" fill="#e2e8f0" stroke="#000" strokeWidth="0.3" className="animate-ping" />
                      )}
                    </svg>
                    <div className="absolute bottom-2 left-2 text-[8px] text-slate-500 font-mono font-bold uppercase">Temp (X-Axis) vs RPM (Y-Axis)</div>
                  </div>
                  <div className="md:col-span-4 flex flex-col gap-2 font-mono text-xs bg-slate-950 p-4 rounded-xl border border-slate-900/80">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Live plot stats</span>
                    <div className="flex justify-between border-b border-slate-900 py-1">
                      <span>Live temp:</span>
                      <span className="text-white font-bold">{metrics.cpu_temp.status === "Success" ? `${parseFloat(metrics.cpu_temp.value).toFixed(1)}°C` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-900 py-1">
                      <span>Live CPU fan:</span>
                      <span className="text-white font-bold">{metrics.cpu_fan.status === "Success" ? `${metrics.cpu_fan.value} RPM` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Calculated Duty:</span>
                      <span className="text-cyan-400 font-bold">
                        {metrics.cpu_fan.status === "Success" ? `${Math.min(100, ((parseFloat(metrics.cpu_fan.value) / 2500) * 100)).toFixed(0)}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Complete Categorized 18 Sensors Grid Panel */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">System Sensor Channels</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Motherboard sensor bus metrics grouped cleanly by system category.
                  </p>
                </div>

                {[
                  {
                    title: "🌡️ Temperature Thermistor Channels",
                    sensors: ["cpu_temp", "cpu_pkg_temp", "mb_temp", "vrm_temp", "chipset_temp"]
                  },
                  {
                    title: "⚡ Power Rail & Voltage Regulators",
                    sensors: ["cpu_vcore", "cpu_vid", "mem_voltage", "rail_3v3", "rail_5v", "rail_12v"]
                  },
                  {
                    title: "💨 Fan & Liquid Pump Tachometers",
                    sensors: ["cpu_fan", "sys_fan", "pump_rpm"]
                  }
                ].map((category, idx) => (
                  <div key={idx} className="border-t border-slate-800/80 pt-4 first:border-0 first:pt-0">
                    <h4 className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider mb-3">{category.title}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {category.sensors.map(sensor_id => {
                        const sensor = metrics[sensor_id];
                        const meta = SENSOR_META[sensor_id];
                        if (!sensor || !meta) return null;
                        
                        const status = sensor.status;
                        let pillClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                        let valClass = "text-white";
                        if (status === "Not Connected") {
                          pillClass = "bg-slate-800 text-slate-400 border-slate-700";
                          valClass = "text-slate-500";
                        } else if (status === "Not Present" || status === "Unsupported") {
                          pillClass = "bg-slate-900 text-slate-600 border-slate-800";
                          valClass = "text-slate-600";
                        } else if (status === "Read Failure" || status === "Unavailable") {
                          pillClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                          valClass = "text-rose-400";
                        }

                        return (
                          <div key={sensor_id} className="bg-slate-950/60 border border-slate-900 rounded-xl p-4 flex flex-col justify-between shadow-inner">
                            <div>
                              <div className="flex justify-between items-start mb-2 gap-2">
                                <span className="text-[10px] font-bold text-slate-400 font-mono tracking-wide leading-tight uppercase">{meta.label}</span>
                                <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold leading-none shrink-0 ${pillClass}`}>
                                  {status}
                                </span>
                              </div>
                              <div className={`text-xl font-bold font-mono ${valClass}`}>
                                {status === "Success" ? `${parseFloat(sensor.value).toFixed(2)}${meta.unit}` : 'N/A'}
                              </div>
                            </div>
                            
                            {status !== "Success" && (
                              <div className="mt-3 text-[10px] text-slate-400 bg-slate-950 p-2 rounded border border-slate-900 leading-normal">
                                {sensor.reason}
                              </div>
                            )}

                            <div className="mt-3 pt-2.5 border-t border-slate-900/60 flex flex-col gap-1 text-[9px] text-slate-500 font-mono">
                              <div className="flex justify-between">
                                <span>SOURCE:</span>
                                <span className="text-slate-300 truncate max-w-[140px] font-medium">{status === "Success" ? sensor.source : 'N/A'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>CONTROLLER:</span>
                                <span className="text-slate-300 truncate max-w-[140px] font-medium">{status === "Success" ? sensor.controller : 'N/A'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Dynamic Super I/O Direct Bus mappings */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-5">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                    Super I/O Real-Time Sensor Channels
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Motherboard hardware registers mapped directly on the physical Super I/O bus interface controller.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">💨 Fan Tachometers</span>
                    <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-900/80 flex flex-col gap-2.5 flex-1 shadow-inner">
                      {metrics.motherboard_fans && metrics.motherboard_fans.length > 0 ? (
                        metrics.motherboard_fans.map((fan, i) => (
                          <div key={i} className="flex justify-between items-center text-xs font-mono py-1.5 border-b border-slate-900/40 last:border-0">
                            <span className="text-slate-300 font-sans">{fan.name}</span>
                            <span className={`font-bold ${fan.status === 'Not Connected' ? 'text-slate-600' : 'text-cyan-400'}`}>
                              {fan.status === 'Not Connected' ? 'Stalled' : `${fan.value} RPM`}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-slate-600 text-xs italic">No active fan channels tracked.</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">🌡️ Thermal Diodes</span>
                    <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-900/80 flex flex-col gap-2.5 flex-1 shadow-inner">
                      {metrics.motherboard_temperatures && metrics.motherboard_temperatures.length > 0 ? (
                        metrics.motherboard_temperatures.map((temp, i) => (
                          <div key={i} className="flex justify-between items-center text-xs font-mono py-1.5 border-b border-slate-900/40 last:border-0">
                            <span className="text-slate-300 font-sans">{temp.name}</span>
                            <span className={`font-bold ${temp.status === 'Read Failure' ? 'text-rose-500' : 'text-emerald-400'}`}>
                              {temp.status === 'Read Failure' ? 'Fault' : `${temp.value}°C`}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-slate-600 text-xs italic">No thermal registers online.</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">⚡ Power Voltage Rails</span>
                    <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-900/80 flex flex-col gap-2.5 flex-1 shadow-inner">
                      {metrics.motherboard_voltages && metrics.motherboard_voltages.length > 0 ? (
                        metrics.motherboard_voltages.map((volt, i) => (
                          <div key={i} className="flex justify-between items-center text-xs font-mono py-1.5 border-b border-slate-900/40 last:border-0">
                            <span className="text-slate-300 font-sans">{volt.name}</span>
                            <span className="font-bold text-amber-400">{parseFloat(volt.value).toFixed(3)}V</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-slate-600 text-xs italic">No voltage rail lines checked.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live rolling event terminal logs console */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 font-mono shadow-lg">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 pb-2 border-b border-slate-800/60">
                  Telemetry Event Console
                </h3>
                <div className="bg-slate-950 rounded-xl border border-slate-900 p-4 text-[11px] max-h-48 overflow-y-auto flex flex-col gap-2 shadow-inner">
                  {events_log.length > 0 ? (
                    events_log.map((evt, idx) => (
                      <div key={idx} className="flex gap-2.5 leading-relaxed align-top">
                        <span className="text-slate-500 select-none">[{evt.timestamp}]</span>
                        <span className={`font-bold uppercase select-none ${evt.type === 'critical' ? 'text-red-500' : evt.type === 'warning' ? 'text-amber-500' : 'text-cyan-400'}`}>
                          {evt.type}
                        </span>
                        <span className="text-slate-300 font-sans">{evt.message}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 italic text-center py-6">All hardware telemetry registers operating normally.</div>
                  )}
                </div>
              </div>

            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 font-mono shadow-lg">
              <div>
                <h2 className="text-base font-bold text-white uppercase tracking-wider">Live Expert Diagnostics Tree</h2>
                <p className="text-xs text-slate-400 mt-1 font-sans">
                  Confidence tracker analyzing hardware anomalies (voltage fluctuations, thermistor short circuits, privilege scopes).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(diagnostics).map(([key, value]) => {
                  const conf = value.confidence;
                  let cardStyle = "border-slate-800 bg-slate-900/30";
                  let badgeStyle = "bg-slate-800 text-slate-400 border-slate-700";
                  if (conf === 'High') {
                    cardStyle = "border-rose-900 bg-rose-950/10 shadow-lg shadow-rose-950/5";
                    badgeStyle = "bg-rose-500/15 text-rose-400 border-rose-500/30";
                  } else if (conf === 'Medium') {
                    cardStyle = "border-amber-900/80 bg-amber-950/10 shadow-lg shadow-amber-950/5";
                    badgeStyle = "bg-amber-500/15 text-amber-400 border-amber-500/30";
                  } else if (conf === 'Low') {
                    cardStyle = "border-cyan-900/50 bg-cyan-950/5";
                    badgeStyle = "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
                  } else {
                    cardStyle = "border-slate-800 bg-slate-900/20";
                    badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                  }
                  
                  return (
                    <div key={key} className={`border rounded-xl p-5 flex flex-col gap-4 transition duration-200 ${cardStyle}`}>
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          {key.replace('_', ' ')}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border font-mono ${badgeStyle}`}>
                          {conf === "No Active Evidence" ? "Healthy" : `${conf} Confidence`}
                        </span>
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1.5">Underlying Evidence Details</span>
                        <ul className="text-xs text-slate-300 space-y-2 pl-4 list-disc font-sans leading-relaxed">
                          {value.evidence.map((ev, i) => (
                            <li key={i}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'selftest' && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 font-mono shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-base font-bold text-white uppercase tracking-wider">Motherboard Diagnostic Test Runner</h2>
                  <p className="text-xs text-slate-400 mt-1 font-sans">
                    Runs active integrity sweeps on SMBIOS parameters, LPC bus mappings, thermal diode loops, and ATX power line margins.
                  </p>
                </div>
                <button 
                  onClick={executeSelfTests}
                  disabled={testing}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 transition text-white text-xs font-bold rounded-lg shadow-md font-mono disabled:opacity-50 shrink-0"
                >
                  {testing ? "Running sweeps..." : "Execute System Integrity Sweep"}
                </button>
              </div>

              {/* Diagnostics terminal and test items log */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 rounded-xl p-4 border border-slate-900/80 shadow-inner h-60 overflow-y-auto font-mono text-[11px] flex flex-col gap-1.5 text-slate-300">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Live test terminal logs console</span>
                  {testLog.length > 0 ? (
                    testLog.map((log, i) => (
                      <div key={i} className={log.includes('[ERROR]') ? 'text-rose-400' : log.includes('[SUCCESS]') ? 'text-emerald-400' : 'text-slate-300'}>
                        {log}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 italic py-12 text-center">Diagnostic test engine idle. Execute sweep to verify hardware registers.</div>
                  )}
                </div>

                <div className="bg-slate-950 rounded-xl p-4 border border-slate-900/80 shadow-inner h-60 overflow-y-auto flex flex-col gap-2.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Self-Test Verification items list</span>
                  {testResults.length > 0 ? (
                    testResults.map((res, i) => (
                      <div key={i} className="p-3 border border-slate-900 rounded-xl bg-slate-950/40 flex flex-col gap-1.5 transition hover:border-slate-800">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white font-bold">{res.test}</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${res.status === 'PASS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                            {res.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-sans leading-relaxed">{res.details}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 italic py-12 text-center text-xs font-mono">No tests executed yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'raw_telemetry' && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 font-mono shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800/60 pb-5">
                <div>
                  <h2 className="text-base font-bold text-white uppercase tracking-wider">LHM Telemetry Register Map</h2>
                  <p className="text-xs text-slate-400 mt-1 font-sans">
                    Raw representation of available motherboard registers mapped in root WMI classes.
                  </p>
                </div>
                <input 
                  type="text" 
                  placeholder="Filter register mappings..." 
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 w-full sm:w-64 focus:outline-none focus:border-cyan-500 font-sans shadow-inner"
                  onChange={(e) => setSearchTerm(e.target.value.toLowerCase())}
                />
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-3 px-3">Register Label</th>
                      <th className="py-3 px-3">Sensor Type</th>
                      <th className="py-3 px-3">Sensor ID / WMI Path</th>
                      <th className="py-3 px-3">Source Chip</th>
                      <th className="py-3 px-3 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSensors && filteredSensors.length > 0 ? (
                      filteredSensors.map((s, idx) => (
                        <tr key={idx} className="border-b border-slate-900 hover:bg-slate-950/40 transition">
                          <td className="py-3 px-3 font-semibold text-cyan-400">{s.name}</td>
                          <td className="py-3 px-3 text-slate-400">{s.type}</td>
                          <td className="py-3 px-3 text-slate-500 text-[10px] select-all leading-relaxed" title={s.mapping}>{s.id}</td>
                          <td className="py-3 px-3 text-slate-300 font-sans">{s.hardware_source}</td>
                          <td className="py-3 px-3 text-right font-bold text-white font-mono">{s.value}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="py-8 text-center text-slate-500 italic">No hardware telemetry registers match this search query.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Glossy bottom tab bar on mobile layouts */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900/90 backdrop-blur-lg border-t border-slate-850 flex lg:hidden justify-around items-center px-4 z-40 shadow-xl">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: '📊' },
          { id: 'diagnostics', label: 'Expert Logs', icon: '🧠' },
          { id: 'selftest', label: 'Self-Test', icon: '🛡' },
          { id: 'raw_telemetry', label: 'Registers', icon: '🔌' }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex flex-col items-center justify-center flex-1 h-full font-mono text-[9px] transition active:scale-95"
          >
            <span className="text-base">{tab.icon}</span>
            <span className={`mt-1 font-semibold ${activeTab === tab.id ? 'text-cyan-400 font-bold' : 'text-slate-400'}`}>{tab.label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}