// Human-readable units for tool output.
export const gb = (bytes?: number) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : undefined);

export const speed = (bytesPerSecond: number) => `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;

export const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
    : `${Math.ceil(seconds / 60)}m`;
