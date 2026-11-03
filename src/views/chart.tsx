// A thin Preact wrapper around ECharts. Only the chart types we use are bundled.
// Colours come from the CSS tokens in style.css, so charts follow light/dark mode.

import { signal, useSignal } from "@preact/signals";
import { BarChart, LineChart, PieChart, SankeyChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "preact/hooks";
import { maskedCents, numbersHidden } from "../hide-numbers";
import { formatCompact } from "../money";
import { theme } from "../theme";

echarts.use([BarChart, LineChart, PieChart, SankeyChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, LabelLayout, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

/**
 * Phone-width screens, where a chart can drop its side labels to give the plot the room.
 * It follows the screen, so turning a phone redraws the charts that read it.
 */
const phoneWidth = matchMedia("(max-width: 700px)");
export const narrowScreen = signal(phoneWidth.matches);
phoneWidth.addEventListener("change", (e) => (narrowScreen.value = e.matches));

/** The current value of a CSS colour token, e.g. token("--series-1"). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Series colours in their fixed order: six for most charts, up to ten where a chart also labels
 * every mark (past six, some pairs get close). Reading theme makes callers re-render on a theme switch.
 */
export function seriesColors(count: 6 | 10 = 6): string[] {
  void theme.value;
  return Array.from({ length: count }, (_, i) => token(`--series-${i + 1}`));
}

/** Shared look: system font, muted axes, hairline grid, tooltip in the page colours. */
export function baseOption(): ChartOption {
  void theme.value;
  const text = token("--text");
  const muted = token("--muted");
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: text },
    // Brief, and off entirely for people who ask their system for less motion.
    animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationDuration: 300,
    tooltip: {
      backgroundColor: token("--surface"),
      borderColor: token("--border"),
      textStyle: { color: text, fontSize: 13 },
      confine: true,
    },
    // Not drawn by the chart: Chart draws it above, as a list that wraps.
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: muted } },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
  };
}

/** Axis styling: no tick marks, hairline baseline, solid hairline gridlines. */
export function axisStyle() {
  return {
    axisLine: { lineStyle: { color: token("--chart-axis") } },
    axisTick: { show: false },
    axisLabel: { color: token("--muted") },
    splitLine: { lineStyle: { color: token("--chart-grid"), type: "solid" as const } },
  };
}

/** The value axis every money chart uses: compact dollars ($1.2K), no axis line. No labels while the numbers are hidden. */
export function moneyAxis() {
  return { type: "value" as const, ...axisStyle(), axisLine: { show: false }, axisLabel: { show: !numbersHidden.value, color: token("--muted"), formatter: formatCompact } };
}

/** Tooltip values in dollars and cents, unless the numbers are hidden. */
export const money = (v: unknown) => maskedCents(Number(v));

interface Props {
  option: ChartOption;
  height: number;
  /** What the chart shows, for screen readers. The table view below each chart has the numbers. */
  label: string;
  /** Called with the clicked data item, e.g. a pie slice, for charts that open the ledger. */
  onPick?: (item: { dataIndex: number; name: string }) => void;
}

interface LegendEntry {
  name: string;
  color: string;
  /** A lighter shade ("the rest" of a stack), drawn at 40% like its bars. */
  faded: boolean;
  dashed: boolean;
}

interface SeriesLike {
  type?: string;
  name?: string;
  itemStyle?: { color?: string; opacity?: number };
  lineStyle?: { type?: string };
  data?: unknown[];
}

/**
 * What the chart's own legend would list, with each name's colour: the legend's data if it names
 * them, otherwise every series (or a pie's slices) in order. None when the chart has no legend.
 */
function legendEntries(option: ChartOption): LegendEntry[] | null {
  const legend = option.legend as { data?: string[]; show?: boolean } | undefined;
  if (!legend || legend.show === false) return null;
  const entries = new Map<string, LegendEntry>();
  const add = (name: string | undefined, style: SeriesLike["itemStyle"], dashed = false) => {
    if (name && !entries.has(name)) entries.set(name, { name, color: style?.color ?? "", faded: (style?.opacity ?? 1) < 1, dashed });
  };
  for (const s of (option.series ?? []) as SeriesLike[]) {
    if (s.type === "pie") for (const d of (s.data ?? []) as SeriesLike[]) add(d.name, d.itemStyle);
    else add(s.name, s.itemStyle, s.lineStyle?.type === "dashed");
  }
  return legend.data ? legend.data.flatMap((n) => entries.get(n) ?? []) : [...entries.values()];
}

export function Chart({ option, height, label, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // The legend is drawn here, above the chart, so it wraps on a narrow screen: the chart's own
  // legend can only scroll, which hid names on a phone. Clicking a name still hides its series.
  const legend = legendEntries(option);
  const hidden = useSignal<ReadonlySet<string>>(new Set());
  // The latest handler, read at click time, so the listener is added once.
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const c = echarts.init(el.current!, null, { renderer: "svg" });
    chart.current = c;
    c.on("click", (p) => pick.current?.({ dataIndex: p.dataIndex, name: p.name }));
    const resize = new ResizeObserver(() => c.resize());
    resize.observe(el.current!);
    return () => {
      resize.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    // The chart keeps its legend (it holds which series are shown) but doesn't draw it, and the
    // plot moves up into the room it took.
    chart.current?.setOption(legend ? {
      ...option,
      legend: { ...(option.legend as object), show: false },
      grid: { ...(option.grid as object), top: 12 },
    } : option, { notMerge: true });
    // A new option shows every series again (a new Set only when some were hidden, to spare a redraw).
    if (hidden.value.size) hidden.value = new Set();
  }, [option]);

  function toggle(name: string) {
    chart.current?.dispatchAction({ type: "legendToggleSelect", name });
    const next = new Set(hidden.value);
    if (!next.delete(name)) next.add(name);
    hidden.value = next;
  }

  return (
    <>
      {legend && (
        <ul class="legend chart-legend" aria-label="Series">
          {legend.map((x) => (
            <li>
              <button type="button" aria-pressed={!hidden.value.has(x.name)} title={hidden.value.has(x.name) ? `Show ${x.name}` : `Hide ${x.name}`}
                onClick={() => toggle(x.name)}>
                <span class={`swatch ${x.dashed ? "dashed" : ""}`} style={{ "--c": x.color, opacity: x.faded ? 0.4 : 1 }} />
                {x.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={el} class="chart" style={{ height }} role="img" aria-label={label} />
    </>
  );
}
