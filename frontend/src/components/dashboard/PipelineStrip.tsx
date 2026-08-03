interface PipelineStripProps {
  classifyTodo: number;
  localizeTodo: number;
  complete: number;
  completePct: number;
  isLoading: boolean;
}

interface SegmentProps {
  first?: boolean;
  toneClass: string; // text color for label + count
  label: string;
  count: number;
  detail: string;
  isLoading: boolean;
}

function Segment({ first, toneClass, label, count, detail, isLoading }: SegmentProps) {
  return (
    <div
      className={`${first ? 'chevron-seg-first' : 'chevron-seg'} flex-1 bg-paper px-5 py-3.5 text-center md:px-8`}
    >
      <div
        className={`font-data text-eyebrow font-medium uppercase tracking-[0.12em] ${toneClass} mb-1`}
      >
        {label}
      </div>
      {isLoading ? (
        <div className="mx-auto h-7 w-14 animate-pulse rounded bg-ash" />
      ) : (
        <div className={`font-data text-2xl font-semibold leading-tight ${toneClass}`}>
          {count.toLocaleString()}
        </div>
      )}
      <div className="font-body text-[11px] text-haze">{detail}</div>
    </div>
  );
}

export default function PipelineStrip({
  classifyTodo,
  localizeTodo,
  complete,
  completePct,
  isLoading,
}: PipelineStripProps) {
  return (
    <div className="my-6 flex flex-col gap-[5px] md:flex-row">
      <Segment
        first
        toneClass="text-ember"
        label="Classify"
        count={classifyTodo}
        detail="waiting for a first pass"
        isLoading={isLoading}
      />
      <Segment
        toneClass="text-pine"
        label="Localize"
        count={localizeTodo}
        detail="boxes still to draw"
        isLoading={isLoading}
      />
      <Segment
        toneClass="text-char"
        label="Complete"
        count={complete}
        detail={`${completePct}% of all sequences`}
        isLoading={isLoading}
      />
    </div>
  );
}
