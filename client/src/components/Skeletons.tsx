import { Logo } from './Logo';

export function RowSkeleton() {
  return (
    <div className="my-6 px-4 md:px-12">
      <div className="shimmer mb-3 h-5 w-48 rounded" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="shimmer aspect-[2/3] w-[42%] shrink-0 rounded-md sm:w-[29%] md:w-[22%] lg:w-[18%] xl:w-[15%]" />
        ))}
      </div>
    </div>
  );
}

export function BrowseSkeleton() {
  return (
    <div>
      <div className="shimmer h-[70vh] min-h-[480px] w-full" />
      <div className="-mt-24 relative">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-black">
      <div className="animate-pulse">
        <Logo size="xl" />
      </div>
    </div>
  );
}
