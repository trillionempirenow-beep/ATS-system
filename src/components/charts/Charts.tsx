import { Area, AreaChart as RArea, Bar, BarChart as RBar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import s from './Charts.module.css';

/** One color per board stage, in STAGE_ORDER: Applied, Screening, Interview, Final interview, Offer, Hired. */
/** The stage scale, in pipeline order (Applied → Hired): how far along reads from the colour itself. */
export const STAGE_CHART_COLORS = ['var(--stage-new)', 'var(--stage-screening)', 'var(--stage-interview)', 'var(--stage-final)', 'var(--stage-offer)', 'var(--stage-hired)'] as const;

function ChartTooltip({ active, payload, label, unit, color }: TooltipProps<number, string> & { unit: string; color: string }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className={s.tooltip}>
      <div className={s.tooltipLabel}>{label}</div>
      <div className={s.tooltipRow}><span className={s.swatch} style={{ background: color }} />{v} {v === 1 ? unit : `${unit}s`}</div>
    </div>
  );
}

const axis = { stroke: 'var(--chart-axis)', fontSize: 12, tickLine: false, axisLine: false } as const;

/** Single-series trend (applications per day). One hue; the card title names the series. */
export function AreaTrend({ data, height = 220, unit, ariaLabel }: { data: Array<{ label: string; value: number }>; height?: number; unit: string; ariaLabel: string }) {
  const empty = data.every((d) => d.value === 0);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RArea data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axis} allowDecimals={false} width={40} domain={[0, empty ? 4 : 'auto']} />
          <Tooltip cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }} content={<ChartTooltip unit={unit} color="var(--chart-1)" />} />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#areaFill)"
            dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--chart-1)' }} />
        </RArea>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars for one measure over time buckets. */
export function BarSeries({ data, height = 220, unit, ariaLabel }: { data: Array<{ label: string; value: number }>; height?: number; unit: string; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBar data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axis} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: 'var(--surface2)' }} content={<ChartTooltip unit={unit} color="var(--chart-1)" />} />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </RBar>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Horizontal magnitude bars with direct labels (pipeline overview, funnel).
 * Plain HTML: the label and value are text, so identity never relies on colour.
 */
export function LabeledBars({ items, max, ariaLabel }: { items: Array<{ label: string; value: number; color?: string }>; max?: number; ariaLabel: string }) {
  const top = Math.max(1, max ?? Math.max(...items.map((i) => i.value), 0));
  return (
    <div className={s.bars} role="list" aria-label={ariaLabel}>
      {items.map((i, idx) => (
        <div key={i.label} className={s.barRow} role="listitem" title={`${i.label}: ${i.value}`}>
          <span className={s.barLabel}>{i.label}</span>
          <span className={s.barTrack}>
            <span className={s.barFill} style={{ width: `${(i.value / top) * 100}%`, background: i.color ?? STAGE_CHART_COLORS[idx % STAGE_CHART_COLORS.length] }} />
          </span>
          <span className={s.barValue}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartEmpty({ children }: { children: string }) {
  return <div className={s.chartEmpty}>{children}</div>;
}
