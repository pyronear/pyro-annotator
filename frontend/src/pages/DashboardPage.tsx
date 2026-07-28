import { usePipelineStats } from '@/hooks/usePipelineStats';
import AttentionBanner from '@/components/dashboard/AttentionBanner';
import PipelineStrip from '@/components/dashboard/PipelineStrip';
import PhaseCard from '@/components/dashboard/PhaseCard';
import HowItWorks from '@/components/dashboard/HowItWorks';

export default function DashboardPage() {
  const stats = usePipelineStats();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-[27px] font-semibold tracking-tight text-char">
        Annotation pipeline
      </h1>
      <p className="mt-1 font-body text-[13.5px] text-haze">
        Two passes: classify what the cameras saw, then localize the smoke.
      </p>

      <div className="mt-4">
        <AttentionBanner count={stats.attention} />
      </div>

      {stats.error ? (
        <p className="my-6 font-body text-[13px] text-signal">
          Statistics failed to load — counts may be missing. Refresh to retry.
        </p>
      ) : (
        <PipelineStrip
          classifyTodo={stats.classifyTodo}
          localizeTodo={stats.localizeTodo}
          complete={stats.complete}
          completePct={stats.completePct}
          isLoading={stats.isLoading}
        />
      )}

      <div className="mb-4 flex flex-col gap-4 md:flex-row">
        <PhaseCard
          pass="01"
          tone="ember"
          passLabel="Classify"
          title="Classify sequences"
          description="Watch each sequence and decide: wildfire smoke, other smoke, or false positive."
          todo={stats.classifyTodo}
          done={stats.classifyDone}
          doneNoun="classified"
          ctaLabel="Start classifying"
          ctaTo="/sequences/annotate"
          reviewLabel="Review classified"
          reviewTo="/sequences/review"
          isLoading={stats.isLoading}
          secondaryLink={{
            label: 'Classify by group',
            to: '/sequence-groups',
            count: stats.groupsToLabel,
          }}
        />
        <PhaseCard
          pass="02"
          tone="pine"
          passLabel="Localize"
          title="Localize smoke"
          description="Draw a tight box around the smoke in every image. Unlocked by Pass 01."
          todo={stats.localizeTodo}
          done={stats.complete}
          doneNoun="localized"
          ctaLabel="Start localizing"
          ctaTo="/detections/annotate"
          reviewLabel="Review localized"
          reviewTo="/detections/review"
          isLoading={stats.isLoading}
        />
      </div>

      <HowItWorks />
    </div>
  );
}
