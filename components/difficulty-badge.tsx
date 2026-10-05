export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span
      className="difficulty-badge"
      data-difficulty={difficulty}
      title="Estimated difficulty based on the required algorithms, reasoning and failure handling."
    >
      {difficulty}
    </span>
  );
}
