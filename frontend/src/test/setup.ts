import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no native dialog lifecycle; browser QA verifies focus trapping.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
