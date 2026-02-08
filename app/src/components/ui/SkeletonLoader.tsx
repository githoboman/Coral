// SkeletonLoader.tsx - Reusable skeleton components

export const SkeletonBox = ({
  className = "",
  rounded = "rounded-xl",
}: {
  className?: string;
  rounded?: string;
}) => <div className={`bg-white/5 animate-pulse ${rounded} ${className}`} />;

export const LeaderboardSkeleton = () => (
  <div className="w-full max-w-4xl mx-auto px-4 py-6">
    <div className="mb-8">
      <SkeletonBox className="h-9 w-48 mb-2" />
      <SkeletonBox className="h-5 w-64" />
    </div>

    <div className="bg-[#151515] border border-white/10 rounded-[30px] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-white/5 border-b border-white/5">
            <tr>
              <th className="px-6 py-4">
                <SkeletonBox className="h-4 w-12" />
              </th>
              <th className="px-6 py-4">
                <SkeletonBox className="h-4 w-16" />
              </th>
              <th className="px-6 py-4">
                <SkeletonBox className="h-4 w-20" />
              </th>
              <th className="px-6 py-4">
                <SkeletonBox className="h-4 w-24" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {[...Array(10)].map((_, i) => (
              <tr key={i}>
                <td className="px-6 py-4">
                  <SkeletonBox className="w-8 h-8 rounded-lg" />
                </td>
                <td className="px-6 py-4">
                  <SkeletonBox className="h-5 w-32 mb-1" />
                  <SkeletonBox className="h-3 w-24" />
                </td>
                <td className="px-6 py-4">
                  <SkeletonBox className="h-5 w-20" />
                </td>
                <td className="px-6 py-4">
                  <SkeletonBox className="h-5 w-16" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

export const ActivitySkeleton = () => (
  <div className="flex flex-col h-full w-full max-w-7xl mx-auto px-4 pb-6 pt-6">
    {/* Top Cards Skeleton */}
    <div className="flex flex-col md:flex-row gap-6 mb-10">
      <SkeletonBox className="w-full md:w-[280px] h-[180px] rounded-[30px]" />
      <SkeletonBox className="flex-1 h-[180px] rounded-[30px]" />
    </div>

    {/* Controls Skeleton */}
    <div className="flex items-center justify-between mb-6">
      <SkeletonBox className="h-7 w-40" />
      <div className="flex gap-3">
        <SkeletonBox className="h-10 w-32 rounded-full" />
        <SkeletonBox className="h-10 w-64 rounded-full" />
      </div>
    </div>

    {/* Task List Skeleton */}
    <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-8">
      <div className="space-y-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4 flex-1">
              <SkeletonBox className="w-6 h-6 rounded-md" />
              <SkeletonBox className="h-5 w-64" />
            </div>
            <div className="flex items-center gap-12">
              <SkeletonBox className="h-7 w-20 rounded-full" />
              <SkeletonBox className="h-5 w-24" />
              <SkeletonBox className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
