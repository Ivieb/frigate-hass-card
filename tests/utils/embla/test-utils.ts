import { EmblaCarouselType, EmblaEventType } from 'embla-carousel';
import { EngineType } from 'embla-carousel/components/Engine';
import { LooseOptionsType } from 'embla-carousel/components/Options';
import { OptionsHandlerType } from 'embla-carousel/components/OptionsHandler';
import merge from 'lodash-es/merge';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

export const createTestEmblaOptionHandler = (): OptionsHandlerType => ({
  mergeOptions: <TypeA extends LooseOptionsType, TypeB extends LooseOptionsType>(
    optionsA: TypeA,
    optionsB?: TypeB,
  ): TypeA => {
    return merge({}, optionsA, optionsB);
  },
  optionsAtMedia: <Type extends LooseOptionsType>(options: Type): Type => {
    return options;
  },
  optionsMediaQueries: (_optionsList: LooseOptionsType[]): MediaQueryList[] => [],
});

export const callEmblaHandler = (
  emblaApi: EmblaCarouselType | null,
  eventName: EmblaEventType,
): void => {
  if (!emblaApi) {
    return;
  }
  const mock = vi.mocked(emblaApi.on).mock;
  for (const [evt, cb] of mock.calls) {
    if (evt === eventName) {
      cb(emblaApi, evt);
    }
  }
};

export const callVisibilityHandler = (): void => {
  const mock = vi.mocked(global.document.addEventListener).mock;
  for (const [evt, cb] of mock.calls) {
    if (evt === 'visibilitychange' && typeof cb === 'function') {
      cb(new Event('foo'));
    }
  }
};

export const callIntersectionHandler = (intersecting = true, n = 0): void => {
  const mockResult = vi.mocked(IntersectionObserver).mock.results[n];
  if (mockResult.type !== 'return') {
    return;
  }
  const observer = mockResult.value;
  vi.mocked(IntersectionObserver).mock.calls[n][0](
    // Note this is a very incomplete / invalid IntersectionObserverEntry that
    // just provides the bare basics current implementation uses.
    intersecting ? [{ isIntersecting: true } as IntersectionObserverEntry] : [],
    observer,
  );
};

export const callMutationHandler = (n = 0): void => {
  const mockResult = vi.mocked(MutationObserver).mock.results[n];
  if (mockResult.type !== 'return') {
    return;
  }
  const observer = mockResult.value;
  vi.mocked(MutationObserver).mock.calls[n][0](
    // Note this is a very incomplete / invalid IntersectionObserverEntry that
    // just provides the bare basics current implementation uses.
    [],
    observer,
  );
};

export const callResizeHandler = (
  entries: {
    target: HTMLElement;
    width: number;
    height: number;
  }[],
  n = 0,
): void => {
  const mockResult = vi.mocked(ResizeObserver).mock.results[n];
  if (mockResult.type !== 'return') {
    return;
  }
  const observer = mockResult.value;
  vi.mocked(ResizeObserver).mock.calls[n][0](
    // Note this is a very incomplete / invalid ResizeObserverEntry that
    // just provides the bare basics current implementation uses.
    entries.map(
      (entry) =>
        ({
          target: entry.target,
          contentRect: {
            height: entry.height,
            width: entry.width,
          },
        } as unknown as ResizeObserverEntry),
    ),
    observer,
  );
};

export const createEmblaApiInstance = (options?: {
  slideNodes?: HTMLElement[];
  selectedScrollSnap?: number;
  previousScrollSnap?: number;
  containerNode?: HTMLElement;
  axis?: 'x' | 'y';
  slideRegistry?: number[][];
}): EmblaCarouselType => {
  const emblaApi = mock<EmblaCarouselType>();
  emblaApi.slideNodes.mockReturnValue(options?.slideNodes ?? createTestSlideNodes());
  emblaApi.selectedScrollSnap.mockReturnValue(options?.selectedScrollSnap ?? 0);
  emblaApi.previousScrollSnap.mockReturnValue(options?.previousScrollSnap ?? 0);
  emblaApi.containerNode.mockReturnValue(
    options?.containerNode ?? document.createElement('div'),
  );
  emblaApi.internalEngine.mockReturnValue({
    options: { axis: options?.axis ?? 'x' },
    ...(options?.slideRegistry && { slideRegistry: options.slideRegistry }),
  } as EngineType);
  return emblaApi;
};

export const createTestSlideNodes = (options?: {
  n?: number;
}): HTMLElement[] => {
  return [...Array(options?.n ?? 10).keys()].map((_) =>
    document.createElement('div'),
  );
};