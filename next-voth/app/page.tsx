'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type ScheduleMode = 'optimized' | 'excel';

type ScheduleSummary = {
  ordersTotal: number;
  ordersDeliveredByJan2027: number;
  deliveriesPctByJan2027: number;
  makespanDate?: Date;
  onTimeOrders: number;
  lateOrders: number;
  deliveriesByMonth: Array<{ month: string; count: number }>;
  feasibilityByMonth: Array<{ month: string; demand: number; feasible: number; infeasibleMaterial: number }>;
  infeasibleMaterialOrders: number;
  adjustedOnTimePct: number;
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

// ─── GANTT CONSTANTS ──────────────────────────────────────────────────────────
const BAR_H = 26; // bar height in px
const LANE_H = 34; // vertical space per lane (BAR_H + padding)
const ROW_PAD_TOP = 8; // top padding inside each process row
const ROW_MIN_H = 52; // minimum row height even with 1 lane
const PROCESS_CAPACITY: Record<string, number> = {
  Corte: 1,
  CT: 1,
  'Eng Man': 3,
  Fresadora: 1,
  Montagem: 8,
  'Peq. Usin.': 1,
  Qualidade: 3,
  Rebarba: 1,
  'Serv. Ext.': 99,
  Solda: 5,
  Traçagem: 1,
  'Trat. Sup.': 1,
  Plaina: 1
};

export default function DashboardPage() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [impactoFilter, setImpactoFilter] = useState<string>('all');
  const [scheduleOps, setScheduleOps] = useState<ScheduleOp[]>([]);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('optimized');
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [ganttZoom, setGanttZoom] = useState<'all' | 'apr-jun' | 'jul-oct'>('all');
  const [hoveredOp, setHoveredOp] = useState<ScheduleOp | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  // single scrollable container ref; header/left are sticky
  const ganttScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttTopScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttScrollSyncRef = useRef(false);

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

  const baselineExcelOps = useMemo<ScheduleOp[]>(() => {
    if (!scheduleOps.length) return [];

    const WS_CONFIG: Record<string, { posts: number; hPerDay: number }> = {
      Corte: { posts: 1, hPerDay: 8 },
      CT: { posts: 1, hPerDay: 24 },
      'Eng Man': { posts: 3, hPerDay: 8 },
      Fresadora: { posts: 1, hPerDay: 24 },
      Montagem: { posts: 8, hPerDay: 8 },
      'Peq. Usin.': { posts: 1, hPerDay: 8 },
      Qualidade: { posts: 3, hPerDay: 8 },
      Rebarba: { posts: 1, hPerDay: 8 },
      'Serv. Ext.': { posts: 99, hPerDay: 24 },
      Solda: { posts: 5, hPerDay: 16 },
      Traçagem: { posts: 1, hPerDay: 8 },
      'Trat. Sup.': { posts: 1, hPerDay: 8 },
      Plaina: { posts: 1, hPerDay: 24 }
    };

    const parseDate = (s: string) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const startAnchor =
      scheduleOps
        .map((o) => parseDate(o.start))
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date();

    const durToCalendarHours = (durH: number, ws: string) => {
      const cfg = WS_CONFIG[ws] ?? { posts: 1, hPerDay: 8 };
      return (durH * 24) / cfg.hPerDay;
    };

    const postAvail: Record<string, number[]> = {};
    for (const [ws, cfg] of Object.entries(WS_CONFIG)) {
      postAvail[ws] = Array.from({ length: cfg.posts }, () => 0);
    }
    const getPosts = (ws: string) => {
      if (!postAvail[ws]) postAvail[ws] = [0];
      return postAvail[ws];
    };

    const orderLastEnd = new Map<string, number>();

    const opsSorted = [...scheduleOps].sort((a, b) => {
      const ao = Number(a.order_id);
      const bo = Number(b.order_id);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
      if (a.order_id !== b.order_id) return a.order_id.localeCompare(b.order_id);
      return (a.seq ?? 0) - (b.seq ?? 0);
    });

    const out: ScheduleOp[] = [];
    for (const op of opsSorted) {
      const ws = op.process;
      const posts = getPosts(ws);
      const prevEnd = orderLastEnd.get(op.order_id) ?? 0;

      let bestIdx = 0;
      let bestAvail = posts[0] ?? 0;
      for (let i = 1; i < posts.length; i++) {
        if (posts[i] < bestAvail) {
          bestAvail = posts[i];
          bestIdx = i;
        }
      }

      const startCalH = Math.max(prevEnd, bestAvail);
      const endCalH = startCalH + durToCalendarHours(op.duration, ws);

      posts[bestIdx] = endCalH;
      orderLastEnd.set(op.order_id, endCalH);

      const startDate = new Date(startAnchor.getTime() + startCalH * 60 * 60 * 1000);
      const endDate = new Date(startAnchor.getTime() + endCalH * 60 * 60 * 1000);

      out.push({
        ...op,
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });
    }

    return out;
  }, [scheduleOps]);

  const displayedScheduleOps = useMemo(() => {
    return scheduleMode === 'optimized' ? scheduleOps : baselineExcelOps;
  }, [scheduleMode, scheduleOps, baselineExcelOps]);

  const scheduleSummaryMemo = useMemo<ScheduleSummary | null>(() => {
    if (!displayedScheduleOps.length) return null;

    const parseDate = (s: string) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    // Per-order completion (max end)
    const orderEnd = new Map<string, Date>();
    const orderStart = new Map<string, Date>();
    const orderDeadline = new Map<string, Date>();
    for (const op of displayedScheduleOps) {
      const end = parseDate(op.end);
      const start = parseDate(op.start);
      if (end) {
        const prev = orderEnd.get(op.order_id);
        if (!prev || end.getTime() > prev.getTime()) orderEnd.set(op.order_id, end);
      }
      if (start) {
        const prev = orderStart.get(op.order_id);
        if (!prev || start.getTime() < prev.getTime()) orderStart.set(op.order_id, start);
      }
      const dl = op.deadline ? parseDate(op.deadline) : null;
      if (dl) {
        const prevDl = orderDeadline.get(op.order_id);
        if (!prevDl || dl.getTime() < prevDl.getTime()) orderDeadline.set(op.order_id, dl);
      }
    }

    const windowStart = new Date('2026-04-01T00:00:00');
    const cutoff = new Date('2027-01-31T23:59:59');
    const finishes = Array.from(orderEnd.entries());
    finishes.sort((a, b) => a[1].getTime() - b[1].getTime());

    // Business view: consider pedidos by deadline month (demanda mensal),
    // e avaliar atendimento dentro da janela Abr/2026 -> Jan/2027.
    const ordersInWindow = finishes.filter(([oid]) => {
      const dl = orderDeadline.get(oid);
      if (!dl) return false;
      return dl.getTime() >= windowStart.getTime() && dl.getTime() <= cutoff.getTime();
    });

    const ordersTotal = ordersInWindow.length;
    const ordersDeliveredByJan2027 = ordersInWindow.filter(([, finishDt]) => finishDt.getTime() <= cutoff.getTime()).length;
    const deliveriesPctByJan2027 = ordersTotal ? (ordersDeliveredByJan2027 / ordersTotal) * 100 : 0;
    const makespanDate = finishes.length ? finishes[finishes.length - 1][1] : undefined;

    let onTimeOrders = 0;
    let lateOrders = 0;
    for (const [oid, finish] of ordersInWindow) {
      const dl = orderDeadline.get(oid);
      if (!dl) continue;
      if (finish.getTime() <= dl.getTime()) onTimeOrders += 1;
      else lateOrders += 1;
    }

    // Proxy for material infeasibility (since JSON has no material date):
    // if first operation starts after deadline, order is infeasible at origin.
    const infeasibleSet = new Set<string>();
    for (const [oid] of ordersInWindow) {
      const dl = orderDeadline.get(oid);
      const st = orderStart.get(oid);
      if (dl && st && st.getTime() > dl.getTime()) infeasibleSet.add(oid);
    }
    const infeasibleMaterialOrders = infeasibleSet.size;
    const feasibleOrders = Math.max(0, ordersTotal - infeasibleMaterialOrders);
    const onTimeFeasible = ordersInWindow.filter(([oid, finish]) => {
      if (infeasibleSet.has(oid)) return false;
      const dl = orderDeadline.get(oid);
      return !!dl && finish.getTime() <= dl.getTime();
    }).length;
    const adjustedOnTimePct = feasibleOrders ? (onTimeFeasible / feasibleOrders) * 100 : 0;

    // Monthly demand by deadline month (e.g. abril = 24 pedidos)
    const byMonth = new Map<string, number>();
    for (const [oid] of ordersInWindow) {
      const dl = orderDeadline.get(oid);
      if (!dl) continue;
      const month = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    const deliveriesByMonth = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));

    const feasibilityMap = new Map<string, { demand: number; infeasibleMaterial: number }>();
    for (const [oid] of ordersInWindow) {
      const dl = orderDeadline.get(oid);
      if (!dl) continue;
      const month = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, '0')}`;
      const cur = feasibilityMap.get(month) ?? { demand: 0, infeasibleMaterial: 0 };
      cur.demand += 1;
      if (infeasibleSet.has(oid)) cur.infeasibleMaterial += 1;
      feasibilityMap.set(month, cur);
    }
    const feasibilityByMonth = Array.from(feasibilityMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        demand: v.demand,
        feasible: Math.max(0, v.demand - v.infeasibleMaterial),
        infeasibleMaterial: v.infeasibleMaterial
      }));

    // Workload by process + max overlap (proxy for congestion)
    const workHours = new Map<string, number>();
    const eventsByProcess = new Map<string, Array<{ t: number; d: number }>>();
    for (const op of displayedScheduleOps) {
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
      feasibilityByMonth,
      infeasibleMaterialOrders,
      adjustedOnTimePct,
      workloadByProcess: workloadByProcess.slice(0, 12),
      topBottleneck
    };
  }, [displayedScheduleOps]);

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

  const feasibilityByMonthChartData = useMemo(() => {
    const labels = scheduleSummary?.feasibilityByMonth.map((d) => d.month) ?? [];
    const demand = scheduleSummary?.feasibilityByMonth.map((d) => d.demand) ?? [];
    const feasible = scheduleSummary?.feasibilityByMonth.map((d) => d.feasible) ?? [];
    const infeasible = scheduleSummary?.feasibilityByMonth.map((d) => d.infeasibleMaterial) ?? [];
    return {
      labels,
      datasets: [
        { label: 'Demanda (prazo no mês)', data: demand, backgroundColor: '#64748b', borderRadius: 6 },
        { label: 'Viáveis', data: feasible, backgroundColor: '#22c55e', borderRadius: 6 },
        { label: 'Inviáveis na origem*', data: infeasible, backgroundColor: '#ef4444', borderRadius: 6 }
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

  const historicalTracker = useMemo(() => {
    const parseDate = (s: string) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const before = new Map<string, { start: Date | null; end: Date | null; process: string; equipment: string }>();
    const after = new Map<string, { start: Date | null; end: Date | null; process: string; equipment: string }>();

    for (const op of baselineExcelOps) {
      const key = `${op.order_id}::${op.seq}`;
      before.set(key, { start: parseDate(op.start), end: parseDate(op.end), process: op.process, equipment: op.equipment });
    }
    for (const op of scheduleOps) {
      const key = `${op.order_id}::${op.seq}`;
      after.set(key, { start: parseDate(op.start), end: parseDate(op.end), process: op.process, equipment: op.equipment });
    }

    let advanced = 0;
    let delayed = 0;
    let unchanged = 0;
    let processChanged = 0;
    let newOps = 0;
    let removedOps = 0;
    const rows: Array<{
      key: string;
      orderId: string;
      seq: number;
      equipment: string;
      processBefore: string;
      processAfter: string;
      startDeltaDays: number;
      endDeltaDays: number;
      status: 'adiantou' | 'atrasou' | 'sem alteração';
    }> = [];

    for (const [key, b] of before.entries()) {
      const a = after.get(key);
      if (!a) {
        removedOps += 1;
        continue;
      }
      const [orderId, seqStr] = key.split('::');
      const seq = Number(seqStr);
      const startDeltaDays = b.start && a.start ? (a.start.getTime() - b.start.getTime()) / 86400000 : 0;
      const endDeltaDays = b.end && a.end ? (a.end.getTime() - b.end.getTime()) / 86400000 : 0;
      if (Math.abs(endDeltaDays) < 1 / 24) unchanged += 1;
      else if (endDeltaDays < 0) advanced += 1;
      else delayed += 1;
      if (b.process !== a.process) processChanged += 1;

      rows.push({
        key,
        orderId,
        seq,
        equipment: a.equipment || b.equipment,
        processBefore: b.process,
        processAfter: a.process,
        startDeltaDays,
        endDeltaDays,
        status: Math.abs(endDeltaDays) < 1 / 24 ? 'sem alteração' : endDeltaDays < 0 ? 'adiantou' : 'atrasou'
      });
    }

    for (const key of after.keys()) {
      if (!before.has(key)) newOps += 1;
    }

    rows.sort((x, y) => Math.abs(y.endDeltaDays) - Math.abs(x.endDeltaDays));
    return { advanced, delayed, unchanged, processChanged, newOps, removedOps, rows: rows.slice(0, 20) };
  }, [baselineExcelOps, scheduleOps]);

  const ganttModel = useMemo(() => {
    if (!displayedScheduleOps.length) {
      return {
        processes: [] as string[],
        rowsByProcess: new Map<string, Array<ScheduleOp & { startMs: number; endMs: number; lane: number }>>(),
        laneCountByProcess: new Map<string, number>(),
        startMs: 0,
        endMs: 0,
        days: 1,
        dayWidth: ganttZoom === 'all' ? 20 : 32,
        dayLabels: [] as string[],
        msPerDay: 24 * 60 * 60 * 1000,
        labelEvery: ganttZoom === 'all' ? 7 : 3
      };
    }

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
    for (const op of displayedScheduleOps) {
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
      const configuredCapacity = PROCESS_CAPACITY[p] ?? 1;
      // Show total points (capacity) in the UI, not only used overlap.
      // For very large capacities (e.g., Serv. Ext. 99), cap visual lanes.
      const visualCapacity = Math.min(configuredCapacity, 12);
      laneCountByProcess.set(p, Math.max(1, visualCapacity, laneEnds.length));
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
    // wider dayWidth for legibility
    const dayWidth = ganttZoom === 'all' ? 20 : 32;
    const labelEvery = ganttZoom === 'all' ? 7 : 3;

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
      msPerDay,
      labelEvery
    };
  }, [displayedScheduleOps, ganttZoom]);

  const ganttColorForProcess = (p: string) => {
    // High-contrast palette (distinct hues, readable on dark bg)
    const map: Record<string, string> = {
      Corte: '#ff6b6b',
      CT: '#8b5cf6',
      'Eng Man': '#22d3ee',
      Fresadora: '#f59e0b',
      Montagem: '#22c55e',
      'Peq. Usin.': '#fb7185',
      Plaina: '#e879f9',
      Qualidade: '#60a5fa',
      Rebarba: '#facc15',
      'Serv. Ext.': '#94a3b8',
      Solda: '#38bdf8',
      Traçagem: '#f97316',
      'Trat. Sup.': '#34d399'
    };
    return map[p] ?? '#a3a3a3';
  };

  const ganttLegend = useMemo(() => {
    const wanted = ['Corte', 'CT', 'Eng Man', 'Fresadora', 'Montagem', 'Peq. Usin.', 'Plaina', 'Qualidade', 'Rebarba', 'Serv. Ext.'];
    return wanted.map((p) => ({ p, c: ganttColorForProcess(p) }));
  }, []);

  const fmtDdMm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const hoveredOpSafe = hoveredOp as ScheduleOp;
  const tooltipPosSafe = tooltipPos as { x: number; y: number };

  return (
    <div className="min-h-screen text-white">
      {/* Background */}
      <div className="fixed inset-0 -z-10 bg-[#070712]" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(1200px_circle_at_20%_10%,rgba(167,139,250,0.22),transparent_60%),radial-gradient(900px_circle_at_85%_25%,rgba(34,211,238,0.18),transparent_55%),radial-gradient(900px_circle_at_35%_85%,rgba(34,197,94,0.12),transparent_60%)]" />
      <div className="fixed inset-0 -z-10 opacity-[0.05] bg-[linear-gradient(to_right,rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.6)_1px,transparent_1px)] bg-[size:56px_56px]" />

      <motion.div className="max-w-7xl mx-auto px-6 py-8" variants={containerVariants} initial="hidden" animate="visible">
        {/* Header */}
        <motion.div variants={itemVariants} className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              VOTH <span className="text-white/60 font-bold">Dashboard</span>
            </h1>
            <p className="text-white/70 mt-2">Otimização de processos · Sequenciamento · Gargalos · Risco</p>
            <p className="text-xs text-white/50 mt-2">Plaina 1 | 24 horas | {processes.length} processos</p>
          </div>
          <div className="text-xs text-white/50 font-mono">
            Fonte: <span className="text-white/70">processos_analisados</span> + <span className="text-white/70">schedule_otimizado</span>
          </div>
        </motion.div>

        {/* KPIs do Cronograma (sequência + materiais + recursos) */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-7 gap-4 mb-10">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-white/60 text-xs tracking-wider uppercase mb-2">Entregas (Abr/2026 a Jan/2027)</p>
            <p className="text-3xl font-bold">
              {scheduleSummary ? `${scheduleSummary.ordersDeliveredByJan2027}/${scheduleSummary.ordersTotal}` : '—'}
            </p>
            <p className="text-xs text-white/50 mt-2">
              {scheduleSummary ? `${scheduleSummary.deliveriesPctByJan2027.toFixed(1)}%` : 'Carregando cronograma…'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-white/60 text-xs tracking-wider uppercase mb-2">Makespan (fim total)</p>
            <p className="text-2xl font-bold">
              {scheduleSummary?.makespanDate ? scheduleSummary.makespanDate.toLocaleDateString('pt-BR') : '—'}
            </p>
            <p className="text-xs text-white/50 mt-2">Conclusão do plano</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-emerald-200/80 text-xs tracking-wider uppercase mb-2">No Prazo (vs prazo)</p>
            <p className="text-3xl font-bold">{scheduleSummary ? scheduleSummary.onTimeOrders : '—'}</p>
            <p className="text-xs text-white/50 mt-2">Ordens dentro do prazo</p>
          </div>
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-rose-200/80 text-xs tracking-wider uppercase mb-2">Atrasadas (vs prazo)</p>
            <p className="text-3xl font-bold">{scheduleSummary ? scheduleSummary.lateOrders : '—'}</p>
            <p className="text-xs text-white/50 mt-2">Ordens fora do prazo</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-white/60 text-xs tracking-wider uppercase mb-2">Maior carga (setor)</p>
            <p className="text-xl font-bold truncate">{scheduleSummary?.topBottleneck?.process ?? '—'}</p>
            <p className="text-xs text-white/50 mt-2">
              {scheduleSummary?.topBottleneck ? `${Math.round(scheduleSummary.topBottleneck.hours)}h · máx ${scheduleSummary.topBottleneck.maxOverlap} simult.` : ''}
            </p>
          </div>
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-rose-200/80 text-xs tracking-wider uppercase mb-2">Inviáveis na origem*</p>
            <p className="text-3xl font-bold">{scheduleSummary ? scheduleSummary.infeasibleMaterialOrders : '—'}</p>
            <p className="text-xs text-white/50 mt-2">Janela Abr/2026-Jan/2027</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-emerald-200/80 text-xs tracking-wider uppercase mb-2">On-time ajustado*</p>
            <p className="text-3xl font-bold">{scheduleSummary ? `${scheduleSummary.adjustedOnTimePct.toFixed(1)}%` : '—'}</p>
            <p className="text-xs text-white/50 mt-2">Exclui inviáveis na origem</p>
          </div>
        </motion.div>

        {/* Cronograma: entregas por mês + carga/congestionamento por setor */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <motion.div variants={itemVariants} className="lg:col-span-1 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Entregas por Mês</h2>
              <div className="text-xs text-white/40 font-mono">dd/mm</div>
            </div>
            <div className="bg-black/20 border border-white/10 p-4 rounded-2xl h-80">
              <Bar data={deliveriesByMonthChartData} options={barOptions} />
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold">Carga e Congestionamento por Setor</h2>
              <div className="text-xs text-white/40">horas + simultaneidade</div>
            </div>
            <p className="text-white/60 text-sm mb-3">Carga = horas totais. Congestionamento = máximo de operações simultâneas (proxy).</p>
            <div className="bg-black/20 border border-white/10 p-4 rounded-2xl h-80">
              <Bar data={workloadByProcessChartData} options={barOptions} />
            </div>
          </motion.div>
        </motion.div>

        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Demanda Mensal x Viabilidade de Material</h2>
            <div className="text-xs text-white/40">prazo por mês</div>
          </div>
          <div className="bg-black/20 border border-white/10 p-4 rounded-2xl h-80">
            <Bar data={feasibilityByMonthChartData} options={barOptions} />
          </div>
          <p className="text-xs text-white/50 mt-3">
            * Proxy atual: “inviável na origem” quando a primeira operação inicia após o prazo da ordem.
          </p>
        </motion.div>

        {/* Historical tracker (change tracking) */}
        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">Historical Plan Tracker</h2>
              <p className="text-white/60 text-sm">Comparação entre Plano Base (Ordem do Excel) e Plano Otimizado.</p>
            </div>
            <div className="text-xs text-white/40">Before vs After</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <p className="text-xs text-emerald-200/80 uppercase tracking-wider">Adiantou</p>
              <p className="text-2xl font-bold">{historicalTracker.advanced}</p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3">
              <p className="text-xs text-rose-200/80 uppercase tracking-wider">Atrasou</p>
              <p className="text-2xl font-bold">{historicalTracker.delayed}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-white/60 uppercase tracking-wider">Sem alteração</p>
              <p className="text-2xl font-bold">{historicalTracker.unchanged}</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
              <p className="text-xs text-amber-200/80 uppercase tracking-wider">Mudou setor</p>
              <p className="text-2xl font-bold">{historicalTracker.processChanged}</p>
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3">
              <p className="text-xs text-sky-200/80 uppercase tracking-wider">Novas ops</p>
              <p className="text-2xl font-bold">{historicalTracker.newOps}</p>
            </div>
            <div className="rounded-xl border border-slate-400/20 bg-slate-400/10 p-3">
              <p className="text-xs text-slate-200/80 uppercase tracking-wider">Removidas</p>
              <p className="text-2xl font-bold">{historicalTracker.removedOps}</p>
            </div>
          </div>

          <div className="overflow-x-auto border border-white/10 rounded-2xl">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 bg-black/20">
                <tr>
                  <th className="text-left py-2 px-3">OP/Seq</th>
                  <th className="text-left py-2 px-3">Equipamento</th>
                  <th className="text-left py-2 px-3">Setor (antes → depois)</th>
                  <th className="text-right py-2 px-3">Δ início (dias)</th>
                  <th className="text-right py-2 px-3">Δ fim (dias)</th>
                  <th className="text-center py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {historicalTracker.rows.map((r) => (
                  <tr key={r.key} className="border-b border-white/10 hover:bg-white/5">
                    <td className="py-2 px-3 font-mono">{r.orderId}/{r.seq}</td>
                    <td className="py-2 px-3">{r.equipment}</td>
                    <td className="py-2 px-3">{r.processBefore} → {r.processAfter}</td>
                    <td className="py-2 px-3 text-right">{r.startDeltaDays.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right">{r.endDeltaDays.toFixed(1)}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-1 rounded-xl text-xs font-semibold ${
                        r.status === 'adiantou' ? 'bg-emerald-400/20 text-emerald-300' :
                        r.status === 'atrasou' ? 'bg-rose-400/20 text-rose-300' :
                        'bg-white/10 text-white/70'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {false && (
        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold">Fluxo de Produção (Gantt)</h2>
              <p className="text-white/60 text-sm">
                Sequência por setor baseada no cronograma {scheduleMode === 'optimized' ? 'otimizado' : 'baseline (ordem do Excel)'}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
                <button
                  onClick={() => setScheduleMode('optimized')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    scheduleMode === 'optimized' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  Otimizado
                </button>
                <button
                  onClick={() => setScheduleMode('excel')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    scheduleMode === 'excel' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  Ordem do Excel
                </button>
              </div>
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

          {/* Legend */}
          <div className="flex flex-wrap gap-2 mb-4">
            {ganttLegend.map(({ p, c }) => (
              <div key={`leg-${p}`} className="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-full px-3 py-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                <div className="text-xs text-slate-200">{p}</div>
              </div>
            ))}
          </div>

          {/* single scrollable container; sticky left + sticky header */}
          <div className="bg-black/20 rounded-2xl border border-white/10 overflow-hidden">
            {/* Top horizontal scrollbar (synced) */}
            <div className="border-b border-white/10 bg-black/20">
              <div
                ref={ganttTopScrollRef}
                className="overflow-x-auto overflow-y-hidden"
                style={{ height: 14 }}
                onScroll={() => {
                  if (ganttScrollSyncRef.current) return;
                  const top = ganttTopScrollRef.current;
                  const main = ganttScrollRef.current;
                  if (!top || !main) return;
                  ganttScrollSyncRef.current = true;
                  main.scrollLeft = top.scrollLeft;
                  requestAnimationFrame(() => {
                    ganttScrollSyncRef.current = false;
                  });
                }}
              >
                <div style={{ width: ganttModel ? 208 + ((ganttModel?.days ?? 0) + 1) * (ganttModel?.dayWidth ?? 1) : 1200, height: 1 }} />
              </div>
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              <div
                ref={ganttScrollRef}
                className="overflow-x-auto"
                onScroll={() => {
                  if (ganttScrollSyncRef.current) return;
                  const top = ganttTopScrollRef.current;
                  const main = ganttScrollRef.current;
                  if (!top || !main) return;
                  ganttScrollSyncRef.current = true;
                  top.scrollLeft = main.scrollLeft;
                  requestAnimationFrame(() => {
                    ganttScrollSyncRef.current = false;
                  });
                }}
              >
                {ganttModel ? (
                  <div style={{ minWidth: 208 + (ganttModel.days + 1) * ganttModel.dayWidth }}>
                    {/* Sticky date-header row */}
                    <div className="flex sticky top-0 z-20 bg-slate-900 border-b border-slate-700" style={{ height: 40 }}>
                      <div
                        className="shrink-0 flex items-center px-3 text-xs font-semibold text-slate-400 border-r border-slate-700 bg-slate-900 sticky left-0 z-30"
                        style={{ width: 208 }}
                      >
                        PROCESSO
                      </div>
                      <div className="flex">
                        {ganttModel.dayLabels.map((label, idx) => (
                          <div
                            key={`dh-${idx}`}
                            className="shrink-0 flex items-center justify-center border-r border-slate-800"
                            style={{ width: ganttModel.dayWidth, height: 40 }}
                          >
                            {idx % ganttModel.labelEvery === 0 ? (
                              <span className="text-[11px] text-slate-300 font-medium">{label}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Process rows */}
                    {ganttModel.processes.map((p, rowIdx) => {
                      const ops = ganttModel.rowsByProcess.get(p) ?? [];
                      const lanes = ganttModel.laneCountByProcess.get(p) ?? 1;
                      const usedLanes = ops.length ? Math.max(...ops.map((o) => o.lane)) + 1 : 0;
                      const rowHeight = Math.max(ROW_MIN_H, ROW_PAD_TOP * 2 + lanes * LANE_H);
                      const zebra = rowIdx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950/60';

                      return (
                        <div key={`row-${p}`} className={`flex border-b border-slate-800 ${zebra}`} style={{ height: rowHeight }}>
                          <div
                            className={`shrink-0 flex items-center px-3 border-r border-slate-700 sticky left-0 z-10 ${zebra}`}
                            style={{ width: 208 }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ganttColorForProcess(p) }} />
                              <span className="text-sm font-semibold text-slate-100 truncate">{p}</span>
                              <span className="text-[10px] text-white/50 shrink-0">{usedLanes}/{lanes}</span>
                            </div>
                          </div>

                          <div className="relative flex-1">
                            {/* Vertical grid lines */}
                            {ganttModel.dayLabels.map((_, idx) => (
                              <div
                                key={`vg-${p}-${idx}`}
                                className="absolute top-0 bottom-0 border-r border-slate-800/50 pointer-events-none"
                                style={{ left: idx * ganttModel.dayWidth, width: ganttModel.dayWidth }}
                              />
                            ))}

                            {/* Bars */}
                            {ops.map((op, i) => {
                              if (op.endMs < ganttModel.startMs || op.startMs > ganttModel.endMs) return null;
                              const leftDays = (op.startMs - ganttModel.startMs) / ganttModel.msPerDay;
                              const widthDays = Math.max(0.25, (op.endMs - op.startMs) / ganttModel.msPerDay);
                              const left = Math.max(0, leftDays * ganttModel.dayWidth);
                              const width = Math.max(4, widthDays * ganttModel.dayWidth);
                              const top = ROW_PAD_TOP + op.lane * LANE_H;
                              const bg = ganttColorForProcess(p);

                              const label = op.equipment || `OP ${op.order_id}`;
                              const showFullLabel = width >= 110;
                              const showDotOnly = width < 20;

                              return (
                                <div
                                  key={`bar-${p}-${op.order_id}-${op.seq}-${i}`}
                                  className="absolute rounded cursor-pointer select-none transition-opacity hover:opacity-100 group overflow-visible"
                                  style={{
                                    left,
                                    width,
                                    top,
                                    height: BAR_H,
                                    backgroundColor: bg,
                                    opacity: op.late ? 0.75 : 0.92,
                                    outline: op.late ? '2px solid #ef4444' : 'none',
                                    outlineOffset: 1,
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
                                  }}
                                  onMouseEnter={(e) => {
                                    setHoveredOp(op);
                                    setTooltipPos({ x: e.clientX, y: e.clientY });
                                  }}
                                  onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => {
                                    setHoveredOp(null);
                                    setTooltipPos(null);
                                  }}
                                >
                                  {/* Hover label (never cut) */}
                                  <div className="hidden group-hover:block absolute -top-8 left-0 z-40 max-w-[360px]">
                                    <div className="px-2 py-1 rounded-lg bg-slate-950/95 border border-white/10 shadow-xl">
                                      <span className="text-[11px] font-semibold text-white whitespace-nowrap">
                                        {label}
                                      </span>
                                    </div>
                                  </div>

                                  {!showDotOnly && (
                                    <div className="h-full flex items-center px-1.5 overflow-hidden" style={{ maxWidth: width }}>
                                      {showFullLabel ? (
                                        <span
                                          className="text-[11px] font-bold leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                                          style={{ color: isLightColor(bg) ? '#0f172a' : '#f8fafc' }}
                                        >
                                          {label}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-bold leading-tight" style={{ color: isLightColor(bg) ? '#0f172a' : '#f8fafc' }}>
                                          {label.slice(0, 3)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-24 flex items-center justify-center text-slate-400 text-sm">Carregando cronograma…</div>
                )}
              </div>
            </div>
          </div>

          {/* Floating tooltip */}
          {hoveredOp && tooltipPos && (
            <div
              className="fixed z-[9999] pointer-events-none"
              style={{ left: tooltipPosSafe.x + 14, top: tooltipPosSafe.y + 14 }}
            >
              <div className="bg-slate-950/95 border border-slate-700 rounded-xl px-4 py-3 shadow-2xl max-w-[360px]">
                <div className="text-sm font-extrabold text-slate-100 truncate">{hoveredOpSafe.equipment || `OP ${hoveredOpSafe.order_id}`}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  <span className="text-slate-200 font-semibold">{hoveredOpSafe.process}</span>
                  <span className="mx-2 text-slate-600">•</span>
                  OP <span className="text-slate-200 font-semibold">{hoveredOpSafe.order_id}</span> · Seq {hoveredOpSafe.seq}
                </div>
                <div className="text-[11px] text-slate-400 mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <span className="text-slate-500">Início:</span> <span className="text-slate-200">{fmtDdMm(new Date(hoveredOpSafe.start))}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Fim:</span> <span className="text-slate-200">{fmtDdMm(new Date(hoveredOpSafe.end))}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Duração:</span>{' '}
                    <span className="text-slate-200 font-semibold">{Number.isFinite(hoveredOpSafe.duration) ? `${hoveredOpSafe.duration.toFixed(1)}h` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Prazo:</span>{' '}
                    <span className={`font-semibold ${hoveredOpSafe.late ? 'text-red-400' : 'text-green-400'}`}>
                      {hoveredOpSafe.deadline ? fmtDdMm(new Date(hoveredOpSafe.deadline)) : '—'} {hoveredOpSafe.late ? '⚠ atraso' : '✓ ok'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
        )}

        {/* KPI Cards */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-white/60 text-xs tracking-wider uppercase mb-2">Total Processos</p>
            <p className="text-3xl font-bold">{processes.length}</p>
          </div>
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-rose-200/80 text-xs tracking-wider uppercase mb-2">Críticos</p>
            <p className="text-3xl font-bold">{impactCounts.high}</p>
          </div>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-amber-200/80 text-xs tracking-wider uppercase mb-2">Atenção</p>
            <p className="text-3xl font-bold">{impactCounts.medium}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <p className="text-emerald-200/80 text-xs tracking-wider uppercase mb-2">Fluidos</p>
            <p className="text-3xl font-bold">{impactCounts.low}</p>
          </div>
        </motion.div>

        {/* Filter */}
        <motion.div variants={itemVariants} className="mb-10">
          <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-3 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="text-xs text-white/50 tracking-wider uppercase">Filtro</div>
            <select
              value={impactoFilter}
              onChange={(e) => setImpactoFilter(e.target.value)}
              className="bg-black/20 border border-white/10 text-white px-4 py-2 rounded-xl focus:outline-none focus:border-white/30"
            >
              <option value="all">Todos os impactos</option>
              <option value="Alto impacto (gargalo crítico)">Alto impacto</option>
              <option value="Médio impacto (atenção)">Médio impacto</option>
              <option value="Baixo impacto (fluido)">Baixo impacto</option>
            </select>
          </div>
        </motion.div>

        {/* Main Grid: Charts + Heatmap */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          {/* Produção: Bar Chart */}
          <motion.div variants={itemVariants} className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Carga de Produção por Posto</h2>
              <div className="text-xs text-white/40">tempo médio + carga</div>
            </div>
            <div className="bg-black/20 border border-white/10 p-4 rounded-2xl h-80">
              <Bar data={barChartData} options={barOptions} />
            </div>
          </motion.div>

          {/* Distribuição: Pie Chart */}
          <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Distribuição de Impactos</h2>
              <div className="text-xs text-white/40">alto / médio / baixo</div>
            </div>
            <div className="flex justify-center h-80">
              <Pie data={pieData} options={pieOptions} />
            </div>
          </motion.div>
        </motion.div>

        {/* Radar Saturação */}
        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-xl font-bold mb-4">Análise Multidimensional - Saturação do Sistema</h2>
          <p className="text-white/60 text-sm mb-6">Capacidade do sistema vs. Limites operacionais. Valores acima de 80% indicam saturação crítica.</p>
          
          {/* Grid de Métricas com Barras Animadas */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            {saturaçãoRadarData.map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                whileHover={{ scale: 1.05 }}
                className="border border-white/10 bg-black/20 rounded-2xl p-4"
              >
                <p className="text-xs font-semibold text-slate-300 mb-3">{item.label}</p>
                <div className="h-32 flex flex-col justify-end relative mb-3 bg-black/20 border border-white/10 rounded-2xl overflow-hidden">
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
                  <div className="absolute top-1 left-2 right-2 text-xs text-white/40">80%</div>
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
          <div className="bg-black/20 border border-white/10 rounded-2xl p-4">
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
        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-xl font-bold mb-4">⚡ Otimização de Fluxo - Reordenação Dinâmica</h2>
          <p className="text-white/60 text-sm mb-4">Visualização de tempo por processo com recomendação de ordem ótima</p>
          
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
          <div className="bg-black/20 border border-white/10 p-4 rounded-2xl h-80 mb-6">
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
          <div className="mt-6 bg-rose-400/10 border border-rose-400/20 rounded-2xl p-4">
            <h3 className="font-bold text-red-400 mb-3">Top 3 Processos Críticos (Ação Imediata)</h3>
            <div className="space-y-2">
              {filtered
                .sort((a, b) => b.BottleneckScore - a.BottleneckScore)
                .slice(0, 3)
                .map((item, idx) => (
                  <div key={`critical-${idx}`} className="flex justify-between items-center bg-black/20 border border-white/10 p-3 rounded-2xl">
                    <div>
                      <p className="font-semibold text-white">{idx + 1}. {item.Posto}</p>
                      <p className="text-xs text-white/50">Score: {item.BottleneckScore.toFixed(3)} | Tempo: {item.Tempo}h | Ordem Ótima: #{item.OrdemOtima}</p>
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
        <motion.div variants={itemVariants} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 mb-10 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <h3 className="text-xl font-bold mb-4">Tabela de Processos (Top 25)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
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
                  <tr key={`${item.Posto}-${item.RankGargalo}`} className="border-b border-white/10 hover:bg-white/5">
                    <td className="py-2 px-2 font-medium">{item.Posto}</td>
                    <td className="text-center py-2 px-2">{item.Tempo}</td>
                    <td className="text-center py-2 px-2">{item.Fila}</td>
                    <td className="text-center py-2 px-2">{item.Dependencias}</td>
                    <td className="text-center py-2 px-2">
                      <span className={`px-2 py-1 rounded-xl text-xs font-semibold ${colorMap[item.Impacto as keyof typeof colorMap] || 'bg-gray-700 text-gray-200'}`}>
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
        <motion.div variants={itemVariants} className="text-center text-white/40 text-sm pb-6">
          <p>Dashboard VOTH © 2026 - Otimização de Processos</p>
        </motion.div>
      </motion.div>
    </div>
  );
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
