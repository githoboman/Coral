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

export const AccountSkeleton = () => (
  <div className="w-full max-w-7xl mx-auto px-6 py-8">
    {/* Header Section Skeleton */}
    <div className="flex items-center justify-between mb-12">
      <div className="flex items-center gap-6">
        <SkeletonBox className="w-24 h-24 rounded-full" />
        <div>
          <SkeletonBox className="h-10 w-48 mb-2" />
          <SkeletonBox className="h-4 w-64" />
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Card Skeleton */}
      <div className="bg-[#0A0A0A] border border-white/10 rounded-[40px] p-8 flex flex-col min-h-[400px]">
        <SkeletonBox className="h-20 w-full rounded-3xl mb-8" />
        <div className="space-y-6 bg-white/5 p-6 rounded-3xl mb-8">
          <SkeletonBox className="h-4 w-24 mb-4" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex justify-between items-center">
              <SkeletonBox className="h-5 w-32" />
              <SkeletonBox className="w-10 h-5 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Right Card Skeleton */}
      <div className="flex flex-col gap-8">
        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] p-8">
          <div className="flex justify-between items-center mb-8">
            <SkeletonBox className="h-10 w-48" />
            <SkeletonBox className="h-6 w-24 rounded-full" />
          </div>
          <SkeletonBox className="h-32 w-full rounded-3xl" />
        </div>

        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] p-8">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <SkeletonBox className="w-10 h-10 rounded-2xl" />
              <SkeletonBox className="h-6 w-32" />
            </div>
            <SkeletonBox className="h-10 w-28 rounded-full" />
          </div>
          <SkeletonBox className="h-2 w-full rounded-full" />
        </div>
      </div>
    </div>
  </div>
);