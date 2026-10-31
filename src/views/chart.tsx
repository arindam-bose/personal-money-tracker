// A thin Preact wrapper around ECharts. Only the chart types we use are bundled.
// Colours come from the CSS tokens in style.css, so charts follow light/dark mode.

import { BarChart, LineChart, PieChart, SankeyChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "preact/hooks";
import { formatCents, formatCompact } from "../money";
import { theme } from "../theme";

echarts.use([BarChart, LineChart, PieChart, SankeyChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, LabelLayout, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;


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
    // One line that scrolls when it doesn't fit (on a phone): wrapped onto more lines, it ran into the chart.
    legend: { type: "scroll", top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: muted } },
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

/** The value axis every money chart uses: compact dollars ($1.2K), no axis line. */
export function moneyAxis() {
  return { type: "value" as const, ...axisStyle(), axisLine: { show: false }, axisLabel: { color: token("--muted"), formatter: formatCompact } };
}

/** Tooltip values in dollars and cents. */
export const money = (v: unknown) => formatCents(Number(v));

interface Props {
  option: ChartOption;
  height: number;
  /** What the chart shows, for screen readers. The table view below each chart has the numbers. */
  label: string;
  /** Called with the clicked data item, e.g. a pie slice, for charts that open the ledger. */
  onPick?: (item: { dataIndex: number; name: string }) => void;
}

export function Chart({ option, height, label, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
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
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} class="chart" style={{ height }} role="img" aria-label={label} />;
}
