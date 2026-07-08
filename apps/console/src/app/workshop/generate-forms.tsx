"use client";

import { useRef, useState, useTransition } from "react";
import { generateQuestionDrafts, generateSparkDrafts } from "./actions";

interface CohortOption {
  id: string;
  name: string;
}

const selectClasses =
  "w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold";

const labelClasses = "mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase";

export function QuestionGenerateForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await generateQuestionDrafts(formData);
      if (result.ok) {
        setSuccess(`Drafted ${result.count} question${result.count === 1 ? "" : "s"}.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-rule bg-white p-5">
      <h3 className="mb-3 font-serif text-lg font-bold text-navy">Draft poll questions</h3>
      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="question-focus" className={labelClasses}>
            What do you want to learn? (optional)
          </label>
          <input
            id="question-focus"
            name="focus"
            disabled={isPending}
            placeholder="e.g. water policy, school bond"
            className={selectClasses}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-800">{success}</p>}
        {isPending && (
          <p className="text-sm text-slate">Drafting + guardrailing… this takes up to a minute.</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
        >
          {isPending ? "Drafting…" : "Generate questions"}
        </button>
      </form>
    </div>
  );
}

export function SparkGenerateForm({ cohorts }: { cohorts: CohortOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await generateSparkDrafts(formData);
      if (result.ok) {
        setSuccess(`Drafted ${result.count} spark${result.count === 1 ? "" : "s"}.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-rule bg-white p-5">
      <h3 className="mb-3 font-serif text-lg font-bold text-navy">Draft conversation sparks</h3>
      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="spark-cohort" className={labelClasses}>
            Cohort
          </label>
          <select id="spark-cohort" name="cohortId" disabled={isPending} className={selectClasses}>
            <option value="">Campaign-wide</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-800">{success}</p>}
        {isPending && (
          <p className="text-sm text-slate">Drafting + guardrailing… this takes up to a minute.</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Drafting…" : "Generate sparks"}
        </button>
      </form>
    </div>
  );
}
