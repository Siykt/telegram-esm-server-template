import Bottleneck from 'bottleneck';
import logger from '../../common/logger.js';

export class RateLimiterControl {
  failedRetryTime = 1000;
  failedRetryLimit = 10;

  protected rateLimiter = new Bottleneck({
    id: 'RateLimiterControl',
    // 30 requests per second limit
    minTime: Math.ceil(1000 / 30),
    maxConcurrent: 30,
  });

  protected checkJobFailError(_error: unknown, retryCount: number): boolean {
    return retryCount < this.failedRetryLimit;
  }

  constructor() {
    this.rateLimiter.on('failed', (error, jobInfo) => {
      if (this.checkJobFailError(error, jobInfo.retryCount)) {
        logger.warn(
          `Job ${jobInfo.options.id} failed ${jobInfo.retryCount + 1}. Retrying after ${
            this.failedRetryTime
          }ms retries.`
        );

        return this.failedRetryTime;
      }

      return;
    });
  }

  createRateLimiterProxy<T extends object>(
    target: T,
    otherWrapper?: (func: (...args: unknown[]) => unknown) => unknown
  ) {
    return new Proxy(target, {
      get: (target, prop, receiver) => {
        const origProperty = target[prop as keyof T];
        if (typeof origProperty === 'function') {
          const origFunc = origProperty.bind(target);
          return this.rateLimiter.wrap(otherWrapper ? otherWrapper(origFunc) : origFunc);
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as T;
  }
}
