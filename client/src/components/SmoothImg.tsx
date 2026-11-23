import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

/**
 * Image qui apparaît en fondu une fois chargée, sur un fond scintillant :
 * plus de cases grises ni d'images qui « tombent » ligne par ligne pendant le défilement.
 */
export function SmoothImg({ className = '', onLoad, src, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(Boolean(ref.current?.complete && ref.current.naturalWidth > 0));
  }, [src]);

  return (
    <>
      {!loaded && <span aria-hidden="true" className="shimmer absolute inset-0" />}
      <img
        ref={ref}
        src={src}
        decoding="async"
        draggable={false}
        onLoad={(event) => {
          setLoaded(true);
          onLoad?.(event);
        }}
        className={`${className} transition-opacity duration-500 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
        {...rest}
      />
    </>
  );
}
