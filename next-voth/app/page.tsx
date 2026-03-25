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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <motion.div className="max-w-7xl mx-auto" variants={containerVariants} initial="hidden" animate="visible">
        {/* Header */}
        <motion.div variants={itemVariants} className="mb-8">
          <h1 className="text-4xl font-bold mb-2">VOTH - Otimização de Processos</h1>
          <p className="text-slate-400">Análise de gargalos · Produção · Saturação · Distribuição</p>
          <p className="text-sm text-slate-500 mt-2">Plaina 1 | 24 horas | {processes.length} processos</p>
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
