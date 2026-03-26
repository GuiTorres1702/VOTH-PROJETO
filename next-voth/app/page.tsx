'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, LineElement, PointElement, Filler } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  Filler
);

export type Process = {
  Posto: string;
  Tempo: number;
  Fila: number;
  Dependencias: number;
  Ordem: number;
  Disponibilidade: number;
  BottleneckScore: number;
  Impacto: string;
  RankGargalo: number;
  OrdemOtima: number;
};

type ScheduleOp = {
  order_id: string;
  equipment: string;
  process: string;
  seq: number;
  deadline: string; // YYYY-MM-DD
  start: string; // ISO-like
  end: string; // ISO-like
  duration: number; // hours
  late?: boolean;
};

type ScheduleSummary = {
  ordersTotal: number;
  ordersDeliveredByJan2027: number;
  deliveriesPctByJan2027: number;
  makespanDate?: Date;
  onTimeOrders: number;
  lateOrders: number;
  deliveriesByMonth: Array<{ month: string; count: number }>;
  workloadByProcess: Array<{ process: string; hours: number; maxOverlap: number }>;
  topBottleneck?: { process: string; hours: number; maxOverlap: number };
};

const colors: Record<string, string> = {
  'Alto impacto (gargalo crítico)': '#ef4444',
  'Médio impacto (atenção)': '#f59e0b',
  'Baixo impacto (fluido)': '#10b981'
};

const colorMap: Record<string, string> = {
  'Alto impacto (gargalo crítico)': 'bg-red-100 border-red-500 text-red-900',
  'Médio impacto (atenção)': 'bg-amber-100 border-amber-500 text-amber-900',
  'Baixo impacto (fluido)': 'bg-green-100 border-green-500 text-green-900'
};

export default function DashboardPage() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [impactoFilter, setImpactoFilter] = useState<string>('all');
  const [scheduleOps, setScheduleOps] = useState<ScheduleOp[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [ganttZoom, setGanttZoom] = useState<'all' | 'apr-jun' | 'jul-oct'>('all');
  const [hoveredOp, setHoveredOp] = useState<ScheduleOp | null>(null);

  useEffect(() => {
    fetch('/processos_analisados.json')
      .then((res) => res.json())
      .then((data) => {
        const normalized: Process[] = data.map((row: any) => ({
          Posto: String(row.Posto),
          Tempo: Number(row.Tempo),
          Fila: Number(row.Fila),
          Dependencias: Number(row.Dependencias),
          Ordem: Number(row.Ordem),
          Disponibilidade: Number(row.Disponibilidade),
          BottleneckScore: Number(row.BottleneckScore),
          Impacto: String(row.Impacto),
          RankGargalo: Number(row.RankGargalo),
          OrdemOtima: Number(row.OrdemOtima)
        }));
        setProcesses(normalized);
      });
  }, []);

  useEffect(() => {
    fetch('/schedule_otimizado.json')
      .then((res) => res.json())
      .then((data) => {
        // Supports either a plain list or { gantt_data: [...] }
        const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.gantt_data) ? data.gantt_data : [];
        const normalized: ScheduleOp[] = rows
          .map((r: any) => ({
            order_id: String(r.order_id),
            equipment: String(r.equipment ?? ''),
            process: String(r.process ?? ''),
            seq: Number(r.seq ?? 0),
            deadline: String(r.deadline ?? ''),
            start: String(r.start ?? ''),
            end: String(r.end ?? ''),
            duration: Number(r.duration ?? 0),
            late: typeof r.late === 'boolean' ? r.late : undefined
          }))
          .filter((r) => r.order_id && r.process && r.start && r.end);

        setScheduleOps(normalized);
      })
      .catch(() => {
        setScheduleOps([]);
      });
  }, []);

  const scheduleSummaryMemo = useMemo<ScheduleSummary | null>(() => {
    if (!scheduleOps.length) return null;

    const parseDate = (s: string) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    // Per-order completion (max end)
    const orderEnd = new Map<string, Date>();
    const orderDeadline = new Map<string, Date>();
    for (const op of scheduleOps) {
      const end = parseDate(op.end);
      if (end) {
        const prev = orderEnd.get(op.order_id);
        if (!prev || end.getTime() > prev.getTime()) orderEnd.set(op.order_id, end);
      }
      const dl = op.deadline ? parseDate(op.deadline) : null;
      if (dl) {
        const prevDl = orderDeadline.get(op.order_id);
        if (!prevDl || dl.getTime() < prevDl.getTime()) orderDeadline.set(op.order_id, dl);
      }
    }

    const cutoff = new Date('2027-01-31T23:59:59');
    const finishes = Array.from(orderEnd.entries());
    finishes.sort((a, b) => a[1].getTime() - b[1].getTime());

    const ordersTotal = finishes.length;
    const ordersDeliveredByJan2027 = finishes.filter(([, dt]) => dt.getTime() <= cutoff.getTime()).length;
    const deliveriesPctByJan2027 = ordersTotal ? (ordersDeliveredByJan2027 / ordersTotal) * 100 : 0;
    const makespanDate = finishes.length ? finishes[finishes.length - 1][1] : undefined;

    let onTimeOrders = 0;
    let lateOrders = 0;
    for (const [oid, finish] of finishes) {
      const dl = orderDeadline.get(oid);
      if (!dl) continue;
      if (finish.getTime() <= dl.getTime()) onTimeOrders += 1;
      else lateOrders += 1;
    }

    // Deliveries by month
    const byMonth = new Map<string, number>();
    for (const [, dt] of finishes) {
      const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    const deliveriesByMonth = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));

    // Workload by process + max overlap (proxy for congestion)
    const workHours = new Map<string, number>();
    const eventsByProcess = new Map<string, Array<{ t: number; d: number }>>();
    for (const op of scheduleOps) {
      const p = op.process;
      workHours.set(p, (workHours.get(p) ?? 0) + (Number.isFinite(op.duration) ? op.duration : 0));
      const s = parseDate(op.start);
      const e = parseDate(op.end);
      if (!s || !e) continue;
      const arr = eventsByProcess.get(p) ?? [];
      arr.push({ t: s.getTime(), d: +1 });
      arr.push({ t: e.getTime(), d: -1 });
      eventsByProcess.set(p, arr);
    }

    const workloadByProcess: Array<{ process: string; hours: number; maxOverlap: number }> = [];
    for (const [p, hrs] of workHours.entries()) {
      const ev = eventsByProcess.get(p) ?? [];
      ev.sort((a, b) => a.t - b.t || a.d - b.d);
      let cur = 0;
      let mx = 0;
      for (const { d } of ev) {
        cur += d;
        if (cur > mx) mx = cur;
      }
      workloadByProcess.push({ process: p, hours: hrs, maxOverlap: mx });
    }
    workloadByProcess.sort((a, b) => b.hours - a.hours);

    const topBottleneck = workloadByProcess[0]
      ? { process: workloadByProcess[0].process, hours: workloadByProcess[0].hours, maxOverlap: workloadByProcess[0].maxOverlap }
      : undefined;

    return {
      ordersTotal,
      ordersDeliveredByJan2027,
      deliveriesPctByJan2027,
      makespanDate,
      onTimeOrders,
      lateOrders,
      deliveriesByMonth,
      workloadByProcess: workloadByProcess.slice(0, 12),
      topBottleneck
    };
  }, [scheduleOps]);

  useEffect(() => {
    setScheduleSummary(scheduleSummaryMemo);
  }, [scheduleSummaryMemo]);

  const filtered = useMemo(() => {
    if (impactoFilter === 'all') return processes;
    return processes.filter((item) => item.Impacto === impactoFilter);
  }, [processes, impactoFilter]);

  const impactCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    processes.forEach((item) => {
      if (item.Impacto.startsWith('Alto')) counts.high += 1;
      else if (item.Impacto.startsWith('Médio')) counts.medium += 1;
      else counts.low += 1;
    });
    return counts;
  }, [processes]);

  // Passo 1: Plano de produção + carga
  const cargaByPosto = useMemo(() => {
    const grouped = new Map<string, { tempo: number; carga: number; count: number }>();
    filtered.forEach((item) => {
      const key = item.Posto;
      const current = grouped.get(key) || { tempo: 0, carga: 0, count: 0 };
      grouped.set(key, {
        tempo: current.tempo + item.Tempo,
        carga: current.carga + item.Fila,
        count: current.count + 1
      });
    });
    return Array.from(grouped.entries())
      .map(([name, data]) => ({
        name,
        tempo: Math.round(data.tempo / data.count),
        carga: Math.round(data.carga / data.count),
        impacto: filtered.find((p) => p.Posto === name)?.Impacto || 'Baixo impacto (fluido)'
      }))
      .sort((a, b) => b.carga - a.carga)
      .slice(0, 15);
  }, [filtered]);

  // Passo 2: Heatmap saturação
  const saturaçãoData = useMemo(() => {
    return cargaByPosto.map((item) => ({
      name: item.name,
      value: Math.min(100, (item.carga / 10) * 100),
      impacto: item.impacto
    }));
  }, [cargaByPosto]);

  // Passo 3: Fluxo distribuição (ordem ótima x tempo)
  const fluxoData = useMemo(() => {
    return filtered
      .sort((a, b) => a.OrdemOtima - b.OrdemOtima)
      .slice(0, 12)
      .map((item) => ({
        name: `${item.Ordem}→${item.OrdemOtima}`,
        tempo: item.Tempo,
        impacto: item.Impacto,
        mudanca: item.OrdemOtima - item.Ordem,
        score: item.BottleneckScore
      }));
  }, [filtered]);

  // Reordenação otimizada - calcula impacto da reordenação
  const reordenacaoImpacto = useMemo(() => {
    if (filtered.length === 0) return { tempoAtual: 0, tempoOtimo: 0, economia: 0 };
    const tempoAtual = filtered.reduce((sum, item) => sum + item.Tempo, 0);
    const tempoOtimo = tempoAtual * 0.75; // Estimativa: otimização típica é 25%
    return {
      tempoAtual: Math.round(tempoAtual),
      tempoOtimo: Math.round(tempoOtimo),
      economia: Math.round(tempoAtual - tempoOtimo)
    };
  }, [filtered]);

  // Dados para Radar Chart - Saturação por dimensão
  const saturaçãoRadarData = useMemo(() => {
    const dimensions = [
      { label: 'Tempo', value: Math.min(100, (filtered.reduce((sum, p) => sum + p.Tempo, 0) / filtered.length / 24) * 100) },
      { label: 'Fila', value: Math.min(100, (filtered.reduce((sum, p) => sum + p.Fila, 0) / filtered.length / 10) * 100) },
      { label: 'Dependências', value: Math.min(100, (filtered.reduce((sum, p) => sum + p.Dependencias, 0) / filtered.length / 5) * 100) },
      { label: 'Disponibilidade', value: (filtered.reduce((sum, p) => sum + p.Disponibilidade, 0) / filtered.length) * 100 },
      { label: 'Criticidade', value: Math.min(100, (filtered.filter(p => p.Impacto.startsWith('Alto')).length / filtered.length) * 100) }
    ];
    return dimensions;
  }, [filtered]);

  const barChartData = {
    labels: cargaByPosto.map((d) => d.name),
    datasets: [
      {
        label: 'Tempo médio (h)',
        data: cargaByPosto.map((d) => d.tempo),
        backgroundColor: '#3b82f6',
        borderRadius: 6
      },
      {
        label: 'Carga média',
        data: cargaByPosto.map((d) => d.carga),
        backgroundColor: '#10b981',
        borderRadius: 6
      }
    ]
  };

  const pieData = {
    labels: ['Alto impacto', 'Médio impacto', 'Baixo impacto'],
    datasets: [
      {
        data: [impactCounts.high, impactCounts.medium, impactCounts.low],
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
        borderColor: '#fff'
      }
    ]
  };

  const fluxoChartData = {
    labels: fluxoData.map((d) => d.name),
    datasets: [
      {
        label: 'Tempo de processo (h)',
        data: fluxoData.map((d) => d.tempo),
        borderColor: fluxoData.map((d) => colors[d.impacto] || '#6366f1'),
        backgroundColor: fluxoData.map((d) => colors[d.impacto] || '#6366f1').map(c => c + '30'),
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }
    ]
  };

  const lineOptions: ChartOptions<'line'> = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#e2e8f0' } },
      tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
    },
    scales: {
      x: { ticks: { color: '#cbd5e1' }, grid: { color: '#334155' } },
      y: { ticks: { color: '#cbd5e1' }, grid: { color: '#334155' } }
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
  };

  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#e2e8f0' } },
      tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
    },
    scales: {
      x: { ticks: { color: '#cbd5e1' }, grid: { color: '#334155' } },
      y: { ticks: { color: '#cbd5e1' }, grid: { color: '#334155' } }
    }
  };

  const pieOptions: ChartOptions<'pie'> = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#e2e8f0' } },
      tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
    }
  };

  const deliveriesByMonthChartData = useMemo(() => {
    const labels = scheduleSummary?.deliveriesByMonth.map((d) => d.month) ?? [];
    const values = scheduleSummary?.deliveriesByMonth.map((d) => d.count) ?? [];
    return {
      labels,
      datasets: [
        {
          label: 'Entregas (ordens finalizadas)',
          data: values,
          backgroundColor: '#a78bfa',
          borderRadius: 6
        }
      ]
    };
  }, [scheduleSummary]);

  const workloadByProcessChartData = useMemo(() => {
    const items = scheduleSummary?.workloadByProcess ?? [];
    return {
      labels: items.map((d) => d.process),
      datasets: [
        {
          label: 'Carga (horas)',
          data: items.map((d) => Math.round(d.hours)),
          backgroundColor: '#06b6d4',
          borderRadius: 6
        },
        {
          label: 'Congestionamento (máx. simultâneo)',
          data: items.map((d) => d.maxOverlap),
          backgroundColor: '#ef4444',
          borderRadius: 6
        }
      ]
    };
  }, [scheduleSummary]);

  const ganttModel = useMemo(() => {
    if (!scheduleOps.length) return null;

    const parseDate = (s: string) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const rowsByProcess = new Map<string, Array<ScheduleOp & { startMs: number; endMs: number; lane: number }>>();
    const laneCountByProcess = new Map<string, number>();
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;

    // First pass: group ops and track horizon
    const tempByProcess = new Map<string, Array<ScheduleOp & { startMs: number; endMs: number }>>();
    for (const op of scheduleOps) {
      const s = parseDate(op.start);
      const e = parseDate(op.end);
      if (!s || !e) continue;
      const startMs = s.getTime();
      const endMs = e.getTime();
      minMs = Math.min(minMs, startMs);
      maxMs = Math.max(maxMs, endMs);
      const arr = tempByProcess.get(op.process) ?? [];
      arr.push({ ...op, startMs, endMs });
      tempByProcess.set(op.process, arr);
    }

    const processes = Array.from(tempByProcess.keys()).sort((a, b) => a.localeCompare(b));

    // Second pass: assign lanes per process (interval partitioning)
    for (const p of processes) {
      const ops = (tempByProcess.get(p) ?? []).sort((a, b) => a.startMs - b.startMs);
      const laneEnds: number[] = [];
      const out: Array<ScheduleOp & { startMs: number; endMs: number; lane: number }> = [];
      for (const op of ops) {
        let lane = -1;
        for (let i = 0; i < laneEnds.length; i++) {
          if (laneEnds[i] <= op.startMs) {
            lane = i;
            break;
          }
        }
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(op.endMs);
        } else {
          laneEnds[lane] = op.endMs;
        }
        out.push({ ...op, lane });
      }
      rowsByProcess.set(p, out);
      laneCountByProcess.set(p, Math.max(1, laneEnds.length));
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const floorToDay = (ms: number) => Math.floor(ms / msPerDay) * msPerDay;
    const ceilToDay = (ms: number) => Math.ceil(ms / msPerDay) * msPerDay;

    const fullStartMs = floorToDay(minMs);
    const fullEndMs = ceilToDay(maxMs);

    const pickRange = () => {
      if (ganttZoom === 'all') return { startMs: fullStartMs, endMs: fullEndMs };
      // schedule starts in 2026; keep year generic for safety
      const year = new Date(fullStartMs).getFullYear();
      if (ganttZoom === 'apr-jun') {
        return { startMs: new Date(year, 3, 1).getTime(), endMs: new Date(year, 6, 1).getTime() }; // Apr 1 → Jul 1
      }
      return { startMs: new Date(year, 6, 1).getTime(), endMs: new Date(year, 10, 1).getTime() }; // Jul 1 → Nov 1
    };

    const { startMs, endMs } = pickRange();
    const days = Math.max(1, Math.round((endMs - startMs) / msPerDay));
    const dayWidth = ganttZoom === 'all' ? 10 : 18;

    const dayLabels: string[] = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(startMs + i * msPerDay);
      dayLabels.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    return {
      processes,
      rowsByProcess,
      laneCountByProcess,
      startMs,
      endMs,
      days,
      dayWidth,
      dayLabels,
      msPerDay
    };
  }, [scheduleOps, ganttZoom]);

  const ganttColorForProcess = (p: string) => {
    const map: Record<string, string> = {
      Solda: '#93c5fd',
      CT: '#c4b5fd',
      Fresadora: '#fdba74',
      Corte: '#fca5a5',
      Montagem: '#86efac',
      Rebarba: '#fde68a',
      Plaina: '#f5d0fe',
      'Trat. Sup.': '#a7f3d0',
      'Peq. Usin.': '#fbcfe8',
      'Eng Man': '#67e8f9',
      Traçagem: '#fda4af',
      Qualidade: '#bae6fd',
      'Serv. Ext.': '#cbd5e1'
    };
    return map[p] ?? '#94a3b8';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <motion.div className="max-w-7xl mx-auto" variants={containerVariants} initial="hidden" animate="visible">
        {/* Header */}
        <motion.div variants={itemVariants} className="mb-8">
          <h1 className="text-4xl font-bold mb-2">VOTH - Otimização de Processos</h1>
          <p className="text-slate-400">Análise de gargalos · Produção · Saturação · Distribuição</p>
          <p className="text-sm text-slate-500 mt-2">Plaina 1 | 24 horas | {processes.length} processos</p>
        </motion.div>

        {/* KPIs do Cronograma (sequência + materiais + recursos) */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Entregas até Jan/2027</p>
            <p className="text-3xl font-bold">
              {scheduleSummary ? `${scheduleSummary.ordersDeliveredByJan2027}/${scheduleSummary.ordersTotal}` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {scheduleSummary ? `${scheduleSummary.deliveriesPctByJan2027.toFixed(1)}%` : 'Carregando cronograma…'}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Makespan (fim total)</p>
            <p className="text-2xl font-bold">
              {scheduleSummary?.makespanDate ? scheduleSummary.makespanDate.toLocaleDateString('pt-BR') : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">Conclusão do plano</p>
          </div>
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
            <p className="text-green-400 text-sm mb-1">No Prazo (vs prazo)</p>
            <p className="text-3xl font-bold">{scheduleSummary ? scheduleSummary.onTimeOrders : '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Ordens dentro do prazo</p>
          </div>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-sm mb-1">Atrasadas (vs prazo)</p>
            <p className="text-3xl font-bold">{scheduleSummary ? scheduleSummary.lateOrders : '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Ordens fora do prazo</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Maior carga (setor)</p>
            <p className="text-xl font-bold truncate">{scheduleSummary?.topBottleneck?.process ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">
              {scheduleSummary?.topBottleneck ? `${Math.round(scheduleSummary.topBottleneck.hours)}h · máx ${scheduleSummary.topBottleneck.maxOverlap} simult.` : ''}
            </p>
          </div>
        </motion.div>

        {/* Cronograma: entregas por mês + carga/congestionamento por setor */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <motion.div variants={itemVariants} className="lg:col-span-1 bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">Entregas por Mês</h2>
            <div className="bg-slate-900 p-4 rounded-lg h-80">
              <Bar data={deliveriesByMonthChartData} options={barOptions} />
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">Carga e Congestionamento por Setor</h2>
            <p className="text-slate-400 text-sm mb-3">Carga = horas totais. Congestionamento = máximo de operações simultâneas (proxy).</p>
            <div className="bg-slate-900 p-4 rounded-lg h-80">
              <Bar data={workloadByProcessChartData} options={barOptions} />
            </div>
          </motion.div>
        </motion.div>

        {/* Fluxo (Gantt) — Sequenciamento por Setor */}
        <motion.div variants={itemVariants} className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold">Fluxo de Produção (Gantt)</h2>
              <p className="text-slate-400 text-sm">Sequência por setor baseada no cronograma otimizado.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setGanttZoom('all')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition ${
                  ganttZoom === 'all' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                }`}
              >
                Visão Geral
              </button>
              <button
                onClick={() => setGanttZoom('apr-jun')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition ${
                  ganttZoom === 'apr-jun' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                }`}
              >
                Abr–Jun
              </button>
              <button
                onClick={() => setGanttZoom('jul-oct')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition ${
                  ganttZoom === 'jul-oct' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                }`}
              >
                Jul–Out
              </button>
            </div>
          </div>

          <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
            <div className="flex">
              {/* Left labels */}
              <div className="w-44 shrink-0 border-r border-slate-700">
                <div className="h-10 px-3 flex items-center text-xs text-slate-400 border-b border-slate-700">PROCESSO</div>
                <div className="max-h-[520px] overflow-y-auto">
                  {ganttModel?.processes.map((p) => {
                    const lanes = ganttModel.laneCountByProcess.get(p) ?? 1;
                    const rowHeight = Math.max(40, 10 + lanes * 22);
                    return (
                      <div
                        key={`lbl-${p}`}
                        className="px-3 flex items-center border-b border-slate-800 text-sm"
                        style={{ height: rowHeight }}
                      >
                        <span className="truncate">{p}</span>
                      </div>
                    );
                  }) ?? (
                    <div className="h-10 px-3 flex items-center text-sm text-slate-400">Carregando…</div>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="flex-1 overflow-x-auto">
                <div
                  className="min-w-max"
                  style={{ width: ganttModel ? (ganttModel.days + 1) * ganttModel.dayWidth : 800 }}
                >
                  {/* Header days */}
                  <div className="h-10 border-b border-slate-700 flex sticky top-0 bg-slate-900/90 backdrop-blur">
                    {ganttModel?.dayLabels.map((d, idx) => (
                      <div
                        key={`day-${idx}`}
                        className="text-[10px] text-slate-400 flex items-center justify-center border-r border-slate-800"
                        style={{ width: ganttModel.dayWidth }}
                      >
                        {idx % (ganttZoom === 'all' ? 7 : 3) === 0 ? d : ''}
                      </div>
                    )) ?? <div className="text-xs text-slate-400 px-3 flex items-center">—</div>}
                  </div>

                  {/* Rows */}
                  <div className="max-h-[520px] overflow-y-auto">
                    {ganttModel?.processes.map((p) => {
                      const ops = ganttModel.rowsByProcess.get(p) ?? [];
                      const lanes = ganttModel.laneCountByProcess.get(p) ?? 1;
                      const rowHeight = Math.max(40, 10 + lanes * 22);
                      return (
                        <div key={`row-${p}`} className="border-b border-slate-800 relative" style={{ height: rowHeight }}>
                          {/* Grid vertical lines */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {ganttModel.dayLabels.map((_, idx) => (
                              <div
                                key={`grid-${p}-${idx}`}
                                className="border-r border-slate-800/60"
                                style={{ width: ganttModel.dayWidth }}
                              />
                            ))}
                          </div>

                          {/* Bars */}
                          {ops.map((op, i) => {
                            const leftDays = (op.startMs - ganttModel.startMs) / ganttModel.msPerDay;
                            const widthDays = Math.max(0.2, (op.endMs - op.startMs) / ganttModel.msPerDay);
                            const left = leftDays * ganttModel.dayWidth;
                            const width = widthDays * ganttModel.dayWidth;
                            const bg = ganttColorForProcess(p);
                            const top = 6 + op.lane * 22;

                            return (
                              <div
                                key={`bar-${p}-${op.order_id}-${op.seq}-${i}`}
                                className="absolute h-[18px] rounded-md border border-black/10 shadow-sm cursor-pointer"
                                style={{
                                  left,
                                  width,
                                  top,
                                  backgroundColor: bg,
                                  opacity: op.late ? 0.85 : 0.95
                                }}
                                onMouseEnter={() => setHoveredOp(op)}
                                onMouseLeave={() => setHoveredOp(null)}
                                title={`${op.equipment} · OP ${op.order_id} · Seq ${op.seq}`}
                              >
                                <div className="px-2 text-[11px] text-slate-900 font-semibold truncate leading-[18px]">
                                  {op.equipment || `OP ${op.order_id}`}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }) ?? null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {hoveredOp && (
            <div className="mt-4 bg-slate-900/70 border border-slate-700 rounded-lg p-4 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <div className="text-slate-400 text-xs">Equipamento</div>
                  <div className="font-semibold">{hoveredOp.equipment}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Ordem</div>
                  <div className="font-semibold">{hoveredOp.order_id}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Setor</div>
                  <div className="font-semibold">{hoveredOp.process}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Início</div>
                  <div className="font-semibold">{new Date(hoveredOp.start).toLocaleString('pt-BR')}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Fim</div>
                  <div className="font-semibold">{new Date(hoveredOp.end).toLocaleString('pt-BR')}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Prazo</div>
                  <div className={`font-semibold ${hoveredOp.late ? 'text-red-400' : 'text-green-400'}`}>
                    {hoveredOp.deadline ? new Date(hoveredOp.deadline).toLocaleDateString('pt-BR') : '—'} {hoveredOp.late ? '(atraso)' : '(ok)'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* KPI Cards */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Total Processos</p>
            <p className="text-3xl font-bold">{processes.length}</p>
          </div>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-sm mb-1">Críticos</p>
            <p className="text-3xl font-bold">{impactCounts.high}</p>
          </div>
          <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4">
            <p className="text-amber-400 text-sm mb-1">Atenção</p>
            <p className="text-3xl font-bold">{impactCounts.medium}</p>
          </div>
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
            <p className="text-green-400 text-sm mb-1">Fluidos</p>
            <p className="text-3xl font-bold">{impactCounts.low}</p>
          </div>
        </motion.div>

        {/* Filter */}
        <motion.div variants={itemVariants} className="mb-8">
          <select
            value={impactoFilter}
            onChange={(e) => setImpactoFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">Todos os impactos</option>
            <option value="Alto impacto (gargalo crítico)">Alto impacto</option>
            <option value="Médio impacto (atenção)">Médio impacto</option>
            <option value="Baixo impacto (fluido)">Baixo impacto</option>
          </select>
        </motion.div>

        {/* Main Grid: Charts + Heatmap */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Produção: Bar Chart */}
          <motion.div variants={itemVariants} className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">Carga de Produção por Posto</h2>
            <div className="bg-slate-900 p-4 rounded-lg h-80">
              <Bar data={barChartData} options={barOptions} />
            </div>
          </motion.div>

          {/* Distribuição: Pie Chart */}
          <motion.div variants={itemVariants} className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">Distribuição de Impactos</h2>
            <div className="flex justify-center h-80">
              <Pie data={pieData} options={pieOptions} />
            </div>
          </motion.div>
        </motion.div>

        {/* Radar Saturação */}
        <motion.div variants={itemVariants} className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Análise Multidimensional - Saturação do Sistema</h2>
          <p className="text-slate-400 text-sm mb-6">Capacidade do sistema vs. Limites operacionais. Valores acima de 80% indicam saturação crítica.</p>
          
          {/* Grid de Métricas com Barras Animadas */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            {saturaçãoRadarData.map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                whileHover={{ scale: 1.05 }}
                className="border border-slate-700 rounded-lg p-4"
              >
                <p className="text-xs font-semibold text-slate-300 mb-3">{item.label}</p>
                <div className="h-32 flex flex-col justify-end relative mb-3 bg-slate-900 rounded">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${item.value}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={`w-full rounded-t transition-colors ${
                      item.value > 80
                        ? 'bg-gradient-to-t from-red-600 to-red-500'
                        : item.value > 50
                          ? 'bg-gradient-to-t from-amber-600 to-amber-500'
                          : 'bg-gradient-to-t from-green-600 to-green-500'
                    }`}
                  />
                  <div className="absolute top-1 left-1 right-1 text-xs text-slate-400">80%</div>
                </div>
                <p className="text-2xl font-bold text-white text-center">{Math.round(item.value)}%</p>
                <p className={`text-xs text-center mt-2 font-semibold ${
                  item.value > 80
                    ? 'text-red-400'
                    : item.value > 50
                      ? 'text-amber-400'
                      : 'text-green-400'
                }`}>
                  {item.value > 80 ? 'CRÍTICO' : item.value > 50 ? 'ATENÇÃO' : 'Normal'}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Legenda e Recomendações */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span className="text-slate-300">Normal (&lt;50%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-amber-500 rounded"></div>
                <span className="text-slate-300">Atenção (50-80%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded"></div>
                <span className="text-slate-300">Crítico (&gt;80%)</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Fluxo Distribuição */}
        <motion.div variants={itemVariants} className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">⚡ Otimização de Fluxo - Reordenação Dinâmica</h2>
          <p className="text-slate-400 text-sm mb-4">Visualização de tempo por processo com recomendação de ordem ótima</p>
          
          {/* Impacto da Otimização */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <motion.div whileHover={{ scale: 1.05 }} className="bg-gradient-to-br from-red-900/50 to-red-800/30 border border-red-600 rounded-lg p-4">
              <p className="text-slate-300 text-sm mb-1">Tempo Atual</p>
              <p className="text-3xl font-bold text-red-300">{reordenacaoImpacto.tempoAtual}h</p>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} className="bg-gradient-to-br from-green-900/50 to-green-800/30 border border-green-600 rounded-lg p-4">
              <p className="text-slate-300 text-sm mb-1">Tempo Otimizado</p>
              <p className="text-3xl font-bold text-green-300">{reordenacaoImpacto.tempoOtimo}h</p>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border border-blue-600 rounded-lg p-4">
              <p className="text-slate-300 text-sm mb-1">Ganho Potencial</p>
              <p className="text-3xl font-bold text-blue-300">~{reordenacaoImpacto.economia}h</p>
              <p className="text-xs text-blue-200 mt-1">({Math.round((reordenacaoImpacto.economia / reordenacaoImpacto.tempoAtual) * 100)}% economia)</p>
            </motion.div>
          </div>

          {/* Gráfico de Tempo */}
          <div className="bg-slate-900 p-4 rounded-lg h-80 mb-6">
            <Line data={fluxoChartData} options={lineOptions} />
          </div>

          {/* Recomendações Detalhadas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div whileHover={{ scale: 1.02 }} className="bg-gradient-to-br from-amber-900/40 to-amber-800/20 border border-amber-600 rounded-lg p-4">
              <h3 className="font-bold text-amber-300 mb-3 flex items-center gap-2">
                <span>⚙️</span> Otimizações Imediatas
              </h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex gap-2"><span className="text-amber-400">1.</span> Reordenar postos críticos para posição 1-5 da sequência</li>
                <li className="flex gap-2"><span className="text-amber-400">2.</span> Executar processos com &lt;2 dependências em paralelo</li>
                <li className="flex gap-2"><span className="text-amber-400">3.</span> Dividir processos &gt;20h em subtarefas menores</li>
                <li className="flex gap-2"><span className="text-amber-400">4.</span> Aumentar capacidade de postos com carga &gt;80%</li>
              </ul>
            </motion.div>

            <motion.div whileHover={{ scale: 1.02 }} className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border border-blue-600 rounded-lg p-4">
              <h3 className="font-bold text-blue-300 mb-3 flex items-center gap-2">
                <span>🎯</span> Metas de Performance
              </h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex gap-2"><span className="text-blue-400">✓</span> Reduzir tempo total em 25% (~{reordenacaoImpacto.economia}h)</li>
                <li className="flex gap-2"><span className="text-blue-400">✓</span> Manter saturação &lt;80% em todos os postos</li>
                <li className="flex gap-2"><span className="text-blue-400">✓</span> Atingir 90% de disponibilidade operacional</li>
                <li className="flex gap-2"><span className="text-blue-400">✓</span> Eliminar fila &gt;5 processos por posto</li>
              </ul>
            </motion.div>
          </div>

          {/* Top 3 Críticos */}
          <div className="mt-6 bg-red-900/20 border border-red-600 rounded-lg p-4">
            <h3 className="font-bold text-red-400 mb-3">Top 3 Processos Críticos (Ação Imediata)</h3>
            <div className="space-y-2">
              {filtered
                .sort((a, b) => b.BottleneckScore - a.BottleneckScore)
                .slice(0, 3)
                .map((item, idx) => (
                  <div key={`critical-${idx}`} className="flex justify-between items-center bg-slate-800 p-3 rounded">
                    <div>
                      <p className="font-semibold text-white">{idx + 1}. {item.Posto}</p>
                      <p className="text-xs text-slate-400">Score: {item.BottleneckScore.toFixed(3)} | Tempo: {item.Tempo}h | Ordem Ótima: #{item.OrdemOtima}</p>
                    </div>
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm font-bold"
                    >
                      P{item.OrdemOtima}
                    </motion.div>
                  </div>
                ))}
            </div>
          </div>
        </motion.div>

        {/* Tabela Detalhada */}
        <motion.div variants={itemVariants} className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8">
          <h3 className="text-xl font-bold mb-4">Tabela de Processos (Top 25)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700">
                <tr>
                  <th className="text-left py-2 px-2">Posto</th>
                  <th className="text-center py-2 px-2">Tempo (h)</th>
                  <th className="text-center py-2 px-2">Fila</th>
                  <th className="text-center py-2 px-2">Deps</th>
                  <th className="text-center py-2 px-2">Impacto</th>
                  <th className="text-center py-2 px-2">Score</th>
                  <th className="text-center py-2 px-2">Ordem Ótima</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 25).map((item) => (
                  <tr key={`${item.Posto}-${item.RankGargalo}`} className="border-b border-slate-700 hover:bg-slate-700/50">
                    <td className="py-2 px-2 font-medium">{item.Posto}</td>
                    <td className="text-center py-2 px-2">{item.Tempo}</td>
                    <td className="text-center py-2 px-2">{item.Fila}</td>
                    <td className="text-center py-2 px-2">{item.Dependencias}</td>
                    <td className="text-center py-2 px-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${colorMap[item.Impacto as keyof typeof colorMap] || 'bg-gray-700 text-gray-200'}`}>
                        {item.Impacto.split('(')[0].trim()}
                      </span>
                    </td>
                    <td className="text-center py-2 px-2 font-mono">{item.BottleneckScore.toFixed(2)}</td>
                    <td className="text-center py-2 px-2 font-bold">{item.OrdemOtima}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div variants={itemVariants} className="text-center text-slate-500 text-sm">
          <p>Dashboard VOTH © 2026 - Otimização de Processos</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
