import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const ROOT = path.resolve(process.cwd(), '..'); // .../VOTH PROJETO
const EXCEL_PATH = path.join(ROOT, 'Banco de Dados.xlsx');
const PUBLIC_DIR = path.join(process.cwd(), 'public'); // .../next-voth/public

const START_DATE = new Date('2026-03-25T00:00:00');

const WS_CONFIG = {
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

function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    // Excel serial date (roughly); xlsx usually converts, but keep safety
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S));
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCalHours(dt) {
  if (!dt) return 0;
  return (dt.getTime() - START_DATE.getTime()) / (1000 * 60 * 60);
}

function fromCalHours(h) {
  return new Date(START_DATE.getTime() + h * 60 * 60 * 1000);
}

function durToCalHours(durH, ws) {
  const cfg = WS_CONFIG[ws] ?? { posts: 1, hPerDay: 8 };
  return (durH * 24) / cfg.hPerDay;
}

function normalizeProcessName(s) {
  const x = String(s ?? '').trim();
  if (!x) return x;
  if (x.toLowerCase() === 'eng man' || x.toLowerCase() === 'eng man.' || x.toLowerCase() === 'eng manf') return 'Eng Man';
  if (x.toLowerCase() === 'eng man' || x.toLowerCase() === 'eng man') return 'Eng Man';
  if (x.toLowerCase() === 'serv. ext.') return 'Serv. Ext.';
  return x;
}

function readExcelRows() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel not found at: ${EXCEL_PATH}`);
  }
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map((r, idx) => ({ __row: idx, ...r }));
}

function buildOps(rows) {
  const required = ['Ordem de Produção', 'Equipamento', 'Prazo', 'Data de Disponibilidade do Material', 'Processo', 'Duração', 'Número'];
  const cols = Object.keys(rows[0] ?? {});
  for (const c of required) {
    if (!cols.includes(c)) {
      // allow missing material date; others are mandatory
      if (c === 'Data de Disponibilidade do Material') continue;
      throw new Error(`Missing required column '${c}'. Found: ${cols.join(', ')}`);
    }
  }

  const ops = rows.map((r) => {
    const ws = normalizeProcessName(r['Processo']);
    const duration = Number(r['Duração'] ?? 0);
    const deadlineDt = toDate(r['Prazo']);
    const matDt = toDate(r['Data de Disponibilidade do Material']);
    return {
      row: Number(r.__row ?? 0),
      order_id: String(r['Ordem de Produção']),
      equipment: String(r['Equipamento'] ?? '').trim(),
      process: ws,
      seq: Number(r['Número'] ?? 0),
      duration,
      deadline_dt: deadlineDt,
      deadline_cal: toCalHours(deadlineDt),
      mat_cal: toCalHours(matDt)
    };
  });

  // sort within order by seq for safety
  ops.sort((a, b) => {
    if (a.order_id !== b.order_id) return a.order_id.localeCompare(b.order_id);
    return a.seq - b.seq;
  });
  return ops;
}

function scheduleBaselineExcel(ops) {
  // follow Excel row order globally; respect precedence + material + resource capacity
  const byRow = [...ops].sort((a, b) => a.row - b.row);
  const postAvail = {};
  for (const [ws, cfg] of Object.entries(WS_CONFIG)) {
    postAvail[ws] = Array.from({ length: cfg.posts }, () => 0);
  }
  const getPosts = (ws) => {
    if (!postAvail[ws]) postAvail[ws] = [0];
    return postAvail[ws];
  };
  const orderLastEnd = new Map();
  const scheduled = [];

  for (const op of byRow) {
    const ws = op.process;
    const posts = getPosts(ws);
    const prevEnd = orderLastEnd.get(op.order_id) ?? 0;

    // earliest due to precedence + material
    const earliest = Math.max(prevEnd, op.mat_cal || 0);

    // pick earliest post
    let bestIdx = 0;
    let bestAvail = posts[0] ?? 0;
    for (let i = 1; i < posts.length; i++) {
      if (posts[i] < bestAvail) {
        bestAvail = posts[i];
        bestIdx = i;
      }
    }

    const start = Math.max(earliest, bestAvail);
    const end = start + durToCalHours(op.duration, ws);
    posts[bestIdx] = end;
    orderLastEnd.set(op.order_id, end);

    scheduled.push({
      order_id: op.order_id,
      equipment: op.equipment,
      process: ws,
      seq: op.seq,
      deadline: op.deadline_dt ? op.deadline_dt.toISOString().slice(0, 10) : '',
      start: fromCalHours(start).toISOString().slice(0, 16),
      end: fromCalHours(end).toISOString().slice(0, 16),
      duration: op.duration
    });
  }

  return scheduled;
}

function priorityKey(op, earliest, orderOps, idx) {
  let remaining = 0;
  for (let j = idx; j < orderOps.length; j++) {
    remaining += durToCalHours(orderOps[j].duration, orderOps[j].process);
  }
  const slack = op.deadline_cal - earliest - remaining;
  return [slack, op.deadline_cal, op.duration];
}

function scheduleOptimized(ops) {
  // group per order and ensure sequence sorting
  const orders = new Map();
  for (const op of ops) {
    const arr = orders.get(op.order_id) ?? [];
    arr.push(op);
    orders.set(op.order_id, arr);
  }
  for (const [oid, arr] of orders.entries()) {
    arr.sort((a, b) => a.seq - b.seq);
    orders.set(oid, arr);
  }

  const postAvail = {};
  for (const [ws, cfg] of Object.entries(WS_CONFIG)) {
    postAvail[ws] = Array.from({ length: cfg.posts }, () => 0);
  }
  const getPosts = (ws) => {
    if (!postAvail[ws]) postAvail[ws] = [0];
    return postAvail[ws];
  };

  const orderLastEnd = new Map(Array.from(orders.keys()).map((k) => [k, 0]));
  const orderNextIdx = new Map(Array.from(orders.keys()).map((k) => [k, 0]));
  const scheduled = [];

  for (let iteration = 0; iteration < 200_000; iteration++) {
    let done = true;
    for (const [oid, arr] of orders.entries()) {
      if ((orderNextIdx.get(oid) ?? 0) < arr.length) {
        done = false;
        break;
      }
    }
    if (done) break;

    const ready = [];
    for (const [oid, arr] of orders.entries()) {
      const idx = orderNextIdx.get(oid) ?? 0;
      if (idx >= arr.length) continue;
      const op = arr[idx];
      const ws = op.process;
      const earliest = Math.max(orderLastEnd.get(oid) ?? 0, op.mat_cal || 0);
      const [slack, ddl, dur] = priorityKey(op, earliest, arr, idx);
      ready.push({ slack, ddl, dur, oid, idx, op, earliest });
    }
    if (!ready.length) break;
    ready.sort((a, b) => (a.slack - b.slack) || (a.ddl - b.ddl) || (a.dur - b.dur));

    const assigned = new Set();
    let assignedAny = false;

    for (const item of ready) {
      const { oid, idx, op, earliest } = item;
      if (assigned.has(oid)) continue;
      const ws = op.process;
      const posts = getPosts(ws);

      let bestIdx = 0;
      let bestAvail = posts[0] ?? 0;
      for (let i = 1; i < posts.length; i++) {
        if (posts[i] < bestAvail) {
          bestAvail = posts[i];
          bestIdx = i;
        }
      }

      const start = Math.max(earliest, bestAvail);
      const end = start + durToCalHours(op.duration, ws);
      posts[bestIdx] = end;

      scheduled.push({
        order_id: op.order_id,
        equipment: op.equipment,
        process: ws,
        seq: op.seq,
        deadline: op.deadline_dt ? op.deadline_dt.toISOString().slice(0, 10) : '',
        start: fromCalHours(start).toISOString().slice(0, 16),
        end: fromCalHours(end).toISOString().slice(0, 16),
        duration: op.duration
      });

      orderNextIdx.set(oid, idx + 1);
      orderLastEnd.set(oid, end);
      assigned.add(oid);
      assignedAny = true;
    }

    if (!assignedAny) break;
  }

  return scheduled;
}

function addLateFlags(scheduled) {
  const orderEnd = new Map();
  const orderDeadline = new Map();

  for (const op of scheduled) {
    const endDt = toDate(op.end);
    const ddlDt = toDate(op.deadline);
    if (endDt) {
      const prev = orderEnd.get(op.order_id);
      if (!prev || endDt.getTime() > prev.getTime()) orderEnd.set(op.order_id, endDt);
    }
    if (ddlDt) {
      const prev = orderDeadline.get(op.order_id);
      if (!prev || ddlDt.getTime() < prev.getTime()) orderDeadline.set(op.order_id, ddlDt);
    }
  }

  const orderLate = new Map();
  for (const [oid, endDt] of orderEnd.entries()) {
    const ddl = orderDeadline.get(oid);
    orderLate.set(oid, ddl ? endDt.getTime() > ddl.getTime() : false);
  }

  return scheduled.map((op) => ({ ...op, late: orderLate.get(op.order_id) ?? false }));
}

function main() {
  const rows = readExcelRows();
  const ops = buildOps(rows);

  const baseline = addLateFlags(scheduleBaselineExcel(ops));
  const optimized = addLateFlags(scheduleOptimized(ops));

  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'schedule_baseline_excel.json'), JSON.stringify(baseline, null, 2), 'utf-8');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'schedule_otimizado.json'), JSON.stringify(optimized, null, 2), 'utf-8');

  console.log('Generated: public/schedule_baseline_excel.json');
  console.log('Generated: public/schedule_otimizado.json');
  console.log('Ops baseline:', baseline.length, 'Ops optimized:', optimized.length);
}

main();
