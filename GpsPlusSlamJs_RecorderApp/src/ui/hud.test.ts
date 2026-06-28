/**
 * Unit tests for HUD / UI module.
 *
 * Tests the fail-fast behavior for required DOM elements
 * and proper initialization order enforcement.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initUI,
  validateEnterButton,
  populateScenarios,
  updateStatus,
  showError,
  updateGpsInfo,
  updateArInfo,
  updateFrameCount,
  hideFrameCount,
  hideRecordingControls,
  showRecordingControls,
  setStopButtonBusy,
  setPermissionsReady,
  setFolderSelected,
  setSaveLocationSelected,
  setFolderImportExpanded,
  updateFolderStatus,
  updateSaveStatus,
  updateRefPointButtonLabel,
  setNewRefPointButtonVisible,
  updatePermissionStatus,
  updateTrackingQuality,
  hideTrackingQuality,
  showUnsupportedPlatformNotice,
  updateRefPointHint,
  type UICallbacks,
} from './hud.js';
import type { PermissionCheckResult } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import {
  extractElementById,
  loadFullIndexHtml,
} from '../test-utils/html-fixtures.js';

/**
 * Creates a minimal DOM structure for testing.
 * Returns cleanup function to reset the DOM.
 */
function setupMinimalDOM(): void {
  document.body.innerHTML = `
    <button id="btn-enter-ar" disabled></button>
    <select id="scenario-select"></select>
    <button id="btn-start"></button>
    <button id="btn-stop" class="hidden"></button>
    <button id="btn-ref-point" class="hidden"></button>
    <button id="btn-new-ref-point" class="hidden"></button>
    <button id="btn-map"></button>
    <button id="btn-open-folder"></button>
    <button id="btn-choose-save"></button>
    <details id="folder-import-section">
      <p id="folder-import-hint" class="hidden"></p>
    </details>
    <div id="setup-modal"></div>
    <div id="new-scenario-section" class="hidden"></div>
    <input id="new-scenario-name" type="text" />
    <span id="status-text"></span>
    <div id="gps-info" class="hidden"><span id="gps-accuracy"></span></div>
    <div id="ar-info" class="hidden"><span id="ar-tracking"></span></div>
    <div id="frame-count-info" class="hidden"><span id="frame-count">0</span></div>
    <div id="tracking-quality" class="hidden">
      <div id="tracking-quality-badge"><span id="tq-state"></span> <span id="tq-confidence"></span></div>
      <div id="tracking-quality-details" class="hidden">
        <div id="tq-convergence"></div>
        <div id="tq-sum-rot"></div>
        <div id="tq-sum-pos"></div>
        <div id="tq-residual"></div>
        <div id="tq-gps-accuracy"></div>
        <div id="tq-coverage"></div>
      </div>
    </div>
    <textarea id="session-notes" disabled></textarea>
    <div id="recording-indicator" class="hidden"></div>
    <p id="enter-ar-hint"></p>
  `;
}

/**
 * Creates a mock UICallbacks object for testing.
 */
function createMockCallbacks(): UICallbacks {
  return {
    onOpenFolder: vi.fn().mockResolvedValue(undefined),
    onChooseSaveLocation: vi.fn().mockResolvedValue(undefined),
    onEnterAR: vi.fn().mockResolvedValue(undefined),
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    onMarkRefPoint: vi.fn(),
    onMarkNewRefPoint: vi.fn(),
    onToggleMap: vi.fn(),
    onMapZoomIn: vi.fn(),
    onMapZoomOut: vi.fn(),
    onScenarioChange: vi.fn(),
    onRequestPermissions: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mocks window.matchMedia and getComputedStyle to simulate CSS transitions.
 * Returns a cleanup function to restore original implementations.
 *
 * @param hasTransition - If true, simulates a 0.3s transition; if false, simulates no transition (0s or reduced motion)
 * @param prefersReducedMotion - If true, simulates prefers-reduced-motion: reduce
 */
function mockTransitionBehavior(
  hasTransition: boolean,
  prefersReducedMotion = false
): () => void {
  const originalMatchMedia = window.matchMedia;
  const originalGetComputedStyle = window.getComputedStyle;

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? prefersReducedMotion
        : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  window.getComputedStyle = vi.fn().mockImplementation((element: Element) => {
    const real = originalGetComputedStyle.call(window, element);
    const duration = hasTransition ? '0.3s' : '0s';
    return {
      ...real,
      transitionDuration: duration,
      getPropertyValue: (prop: string) => {
        if (prop === 'transition-duration') {
          return duration;
        }
        return real.getPropertyValue(prop);
      },
    };
  });

  return () => {
    window.matchMedia = originalMatchMedia;
    window.getComputedStyle = originalGetComputedStyle;
  };
}

describe('initUI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Why this test matters:
   * Verifies fail-fast for btn-enter-ar - a critical button for starting AR.
   */
  it('throws when btn-enter-ar is missing', () => {
    document.body.innerHTML = `
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
      <div id="recording-indicator"></div>
    `;

    expect(() => initUI(createMockCallbacks())).toThrow(
      "Required UI element '#btn-enter-ar' not found"
    );
  });

  /**
   * Why this test matters:
   * Verifies fail-fast for scenario-select dropdown.
   */
  it('throws when scenario-select is missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
      <div id="recording-indicator"></div>
    `;

    expect(() => initUI(createMockCallbacks())).toThrow(
      "Required UI element '#scenario-select' not found"
    );
  });

  /**
   * Why this test matters:
   * Verifies fail-fast for recording control buttons.
   */
  it('throws when recording controls are missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <select id="scenario-select"></select>
      <div id="recording-indicator"></div>
    `;

    expect(() => initUI(createMockCallbacks())).toThrow(
      "Required UI element '#btn-start' not found"
    );
  });

  /**
   * Why this test matters:
   * Confirms that when all required elements exist, initialization succeeds.
   */
  it('succeeds when all required elements are present', () => {
    setupMinimalDOM();

    expect(() => initUI(createMockCallbacks())).not.toThrow();
  });

  /**
   * Why this test matters:
   * The map button is optional - app should work without it.
   */
  it('succeeds when optional btn-map is missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
      <div id="recording-indicator"></div>
    `;

    expect(() => initUI(createMockCallbacks())).not.toThrow();
  });

  /**
   * Why this test matters:
   * The external backup buttons are optional - app works with OPFS alone.
   */
  it('succeeds when external backup buttons are missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
      <div id="recording-indicator"></div>
    `;

    expect(() => initUI(createMockCallbacks())).not.toThrow();
  });

  /**
   * Why this test matters:
   * Verifies fail-fast for recording-indicator element.
   * This element is cached and used during recording start/stop,
   * so missing it should fail early rather than at runtime.
   */
  it('throws when recording-indicator is missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
    `;

    expect(() => initUI(createMockCallbacks())).toThrow(
      "Required UI element '#recording-indicator' not found"
    );
  });
});

describe('validateEnterButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Reset permissions state to default (false) for each test
    setPermissionsReady(false);
  });

  /**
   * Why this test matters:
   * Ensures proper initialization order is enforced.
   * Calling validateEnterButton before initUI is a programming error.
   *
   * Note: Testing this properly requires resetting module state.
   * We use vi.resetModules() and dynamic import to get a fresh module.
   */
  it('throws when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    // Import fresh module without cached state
    const { validateEnterButton: freshValidate } = await import('./hud.js');

    expect(() => freshValidate()).toThrow('called before initUI');
  });

  /**
   * Why this test matters:
   * Validates that permissions must be granted before entering AR.
   * This addresses the requirement for early permission verification.
   */
  it('shows permission hint when permissions not ready', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(false);

    const hint = document.getElementById('enter-ar-hint') as HTMLElement;
    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;

    validateEnterButton();

    expect(btnEnterAR.disabled).toBe(true);
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('Grant required permissions');
  });

  /**
   * Why this test matters:
   * Validates the enable/disable logic based on scenario selection.
   */
  it('enables button when a scenario is selected', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(true); // Permissions must be ready for scenario checks

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;

    // Add an option and select it
    const option = document.createElement('option');
    option.value = 'test-scenario';
    option.textContent = 'Test Scenario';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = 'test-scenario';

    validateEnterButton();

    expect(btnEnterAR.disabled).toBe(false);
  });

  /**
   * Why this test matters:
   * Validates that __new__ selection with empty name keeps button disabled.
   */
  it('disables button when __new__ is selected without a name', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(true); // Permissions must be ready for scenario checks

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;
    const newScenarioName = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement;

    // Add __new__ option and select it
    const option = document.createElement('option');
    option.value = '__new__';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = '__new__';
    newScenarioName.value = '';

    validateEnterButton();

    expect(btnEnterAR.disabled).toBe(true);
  });

  /**
   * Why this test matters:
   * Validates that __new__ with a provided name enables the button.
   */
  it('enables button when __new__ is selected with a name', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(true); // Permissions must be ready for scenario checks

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;
    const newScenarioName = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement;

    // Add __new__ option and select it
    const option = document.createElement('option');
    option.value = '__new__';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = '__new__';
    newScenarioName.value = 'My New Scenario';

    validateEnterButton();

    expect(btnEnterAR.disabled).toBe(false);
  });

  /**
   * Why this test matters:
   * D5 (2026-06-05 recorder setup UX): the read folder is an OPTIONAL import
   * step and must NOT gate Enter AR. With the save location, permissions and a
   * scenario all ready, Enter AR must be enabled even when no folder is open.
   */
  it('does not require a folder — Enter AR enables without a folder when save+permissions+scenario are ready', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(false); // No folder opened
    setSaveLocationSelected(true); // Save location chosen (the real requirement)
    setPermissionsReady(true);

    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;
    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    scenarioSelect.disabled = false;
    const option = document.createElement('option');
    option.value = 'test-scenario';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = 'test-scenario';

    validateEnterButton();

    expect(btnEnterAR.disabled).toBe(false);
  });

  /**
   * Why this test matters:
   * Validates that the hint shows save location hint when folder selected but not save location.
   */
  it('shows save location hint when save location not chosen', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(false); // Folder is optional and irrelevant to the gate
    setSaveLocationSelected(false); // No save location
    setPermissionsReady(true);

    const hint = document.getElementById('enter-ar-hint') as HTMLElement;

    validateEnterButton();

    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('Choose a save location');
  });

  /**
   * Why this test matters:
   * Validates that the hint prompts for scenario name when __new__ is selected.
   */
  it('shows scenario name hint when __new__ selected without name', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(true); // Permissions must be ready for scenario name hint

    const hint = document.getElementById('enter-ar-hint') as HTMLElement;
    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;

    // Enable dropdown (folder selected)
    scenarioSelect.disabled = false;
    const option = document.createElement('option');
    option.value = '__new__';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = '__new__';

    // Clear the index.html prefill so we exercise the "no name typed" path.
    const newScenarioName = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement;
    newScenarioName.value = '';

    validateEnterButton();

    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('Enter a scenario name');
  });

  /**
   * Why this test matters:
   * Validates that the hint is hidden when requirements are met.
   */
  it('hides hint when button is enabled', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    setFolderSelected(true); // Storage setup complete
    setSaveLocationSelected(true);
    setPermissionsReady(true); // Permissions must be ready for button to enable

    const hint = document.getElementById('enter-ar-hint') as HTMLElement;
    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;

    // Enable dropdown and select a valid scenario
    scenarioSelect.disabled = false;
    const option = document.createElement('option');
    option.value = 'test-scenario';
    scenarioSelect.appendChild(option);
    scenarioSelect.value = 'test-scenario';

    validateEnterButton();

    expect(hint.classList.contains('hidden')).toBe(true);
  });
});

/**
 * D5 (2026-06-05 recorder setup UX): the optional folder-import section is
 * collapsed by default and auto-expanded (with a recovery hint) only when the
 * chosen scenario has no saved reference points in OPFS. These tests pin the
 * pure DOM toggling of `setFolderImportExpanded`.
 */
describe('setFolderImportExpanded', () => {
  it('expands the section and shows the hint when expanded with a message', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    setFolderImportExpanded(
      true,
      'no saved reference points — open the folder'
    );

    const section = document.getElementById(
      'folder-import-section'
    ) as HTMLDetailsElement;
    const hint = document.getElementById('folder-import-hint') as HTMLElement;
    expect(section.open).toBe(true);
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('no saved reference points');
  });

  it('collapses the section and clears the hint when collapsed', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
    // First expand it so the collapse is observable.
    setFolderImportExpanded(true, 'recover them');

    setFolderImportExpanded(false);

    const section = document.getElementById(
      'folder-import-section'
    ) as HTMLDetailsElement;
    const hint = document.getElementById('folder-import-hint') as HTMLElement;
    expect(section.open).toBe(false);
    expect(hint.classList.contains('hidden')).toBe(true);
    expect(hint.textContent).toBe('');
  });

  it('does not throw when the folder-import elements are absent (graceful)', () => {
    document.body.innerHTML = '';
    expect(() => setFolderImportExpanded(true, 'x')).not.toThrow();
  });
});

describe('populateScenarios', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Why this test matters:
   * Verifies scenarios are added to the dropdown correctly.
   */
  it('adds scenarios to dropdown', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios(['Scenario A', 'Scenario B', 'Scenario C']);

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    const options = Array.from(scenarioSelect.options);

    // First option is __new__, then the scenarios
    expect(options).toHaveLength(4);
    expect(options[0].value).toBe('__new__');
    expect(options[1].value).toBe('Scenario A');
    expect(options[2].value).toBe('Scenario B');
    expect(options[3].value).toBe('Scenario C');
  });

  /**
   * Why this test matters:
   * Verifies the first existing scenario is auto-selected.
   */
  it('selects first scenario when available', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios(['First', 'Second']);

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    expect(scenarioSelect.value).toBe('First');
  });

  /**
   * Why this test matters:
   * Verifies session notes are enabled after scenarios are populated.
   */
  it('enables session notes', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const sessionNotes = document.getElementById(
      'session-notes'
    ) as HTMLTextAreaElement;
    expect(sessionNotes.disabled).toBe(true);

    populateScenarios(['Test']);

    expect(sessionNotes.disabled).toBe(false);
  });

  /**
   * Why this test matters:
   * Bug fix verification - when folder has no existing scenarios,
   * the new-scenario-section must be shown so user can enter a name.
   * See docs/2026-01-23-user-feedback.md for the original user report.
   */
  it('shows new-scenario-section when no existing scenarios', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios([]);

    const newScenarioSection = document.getElementById('new-scenario-section');
    expect(newScenarioSection?.classList.contains('hidden')).toBe(false);
  });

  /**
   * Why this test matters:
   * Bug fix verification - when folder has no existing scenarios,
   * the dropdown value should be set to __new__.
   */
  it('selects __new__ option when no existing scenarios', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios([]);

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    expect(scenarioSelect.value).toBe('__new__');
  });

  /**
   * Why this test matters:
   * Bug fix verification - when folder has no existing scenarios,
   * the name input should be focused to guide the user.
   */
  it('focuses new-scenario-name input when no existing scenarios', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios([]);

    const newScenarioName = document.getElementById('new-scenario-name');
    expect(document.activeElement).toBe(newScenarioName);
  });

  /**
   * Why this test matters:
   * When there are existing scenarios, the new-scenario-section
   * should stay hidden since the first scenario is auto-selected.
   */
  it('hides new-scenario-section when existing scenarios are present', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    populateScenarios(['Scenario1', 'Scenario2']);

    const newScenarioSection = document.getElementById('new-scenario-section');
    expect(newScenarioSection?.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * UX feedback 2026-05-03: when a folder has no existing scenarios, the
   * user should be able to tap "Enter AR" without typing — `index.html`
   * pre-fills `#new-scenario-name` with the canonical default scenario
   * name. populateScenarios must not clobber this prefill, and once all
   * other gating conditions are met the Enter AR button must be enabled
   * automatically. See docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md.
   */
  it('preserves prefilled new-scenario-name and enables Enter AR without typing', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    // Satisfy the other gating conditions so validateEnterButton can flip.
    setFolderSelected(true);
    setSaveLocationSelected(true);
    setPermissionsReady(true);

    populateScenarios([]);

    const newScenarioName = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement;
    expect(newScenarioName.value).toBe('Default Scenario');

    const btnEnterAR = document.getElementById(
      'btn-enter-ar'
    ) as HTMLButtonElement;
    expect(btnEnterAR.disabled).toBe(false);
  });

  /**
   * Why this test matters:
   * Without this, handleStartRecording would use 'Default Scenario' fallback.
   */
  it('invokes onScenarioChange when auto-selecting first existing scenario', () => {
    setupMinimalDOM();
    const mockCallbacks = createMockCallbacks();
    initUI(mockCallbacks);

    populateScenarios(['MyScenario', 'OtherScenario']);

    expect(mockCallbacks.onScenarioChange).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onScenarioChange).toHaveBeenCalledWith('MyScenario');
  });

  /**
   * Why this test matters:
   * When no existing scenarios, __new__ is selected but onScenarioChange
   * should NOT be invoked since __new__ is a placeholder, not a real scenario.
   */
  it('does not invoke onScenarioChange when no existing scenarios', () => {
    setupMinimalDOM();
    const mockCallbacks = createMockCallbacks();
    initUI(mockCallbacks);

    populateScenarios([]);

    expect(mockCallbacks.onScenarioChange).not.toHaveBeenCalled();
  });
});

describe('updateStatus', () => {
  /**
   * Why this test matters:
   * Verifies status updates work with graceful degradation.
   */
  it('updates status text when element exists', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    updateStatus('Recording...');

    const statusText = document.getElementById('status-text');
    expect(statusText?.textContent).toBe('Recording...');
  });

  /**
   * Why this test matters:
   * Verifies graceful degradation - no crash when element is missing.
   */
  it('does not throw when status-text is missing', () => {
    document.body.innerHTML = `
      <button id="btn-enter-ar"></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop"></button>
      <button id="btn-ref-point"></button>
      <button id="btn-new-ref-point"></button>
      <div id="recording-indicator"></div>
    `;
    initUI(createMockCallbacks());

    expect(() => updateStatus('Test')).not.toThrow();
  });
});

describe('updateFolderStatus', () => {
  /**
   * Why this test matters:
   * Verifies folder-status element is updated with the given text.
   * Centralizing this in hud.ts removes duplicated DOM manipulation from main.ts
   * and folder-manager.ts (junior dev review finding).
   */
  it('updates folder-status text when element exists', () => {
    setupMinimalDOM();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span id="folder-status"></span>'
    );
    initUI(createMockCallbacks());

    updateFolderStatus('✅ MyFolder (3 ref pts)');

    const el = document.getElementById('folder-status');
    expect(el?.textContent).toBe('✅ MyFolder (3 ref pts)');
  });

  /**
   * Why this test matters:
   * Graceful degradation — no crash when the element is missing.
   */
  it('does not throw when folder-status element is missing', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    expect(() => updateFolderStatus('test')).not.toThrow();
  });
});

describe('updateSaveStatus', () => {
  /**
   * Why this test matters:
   * Verifies save-status element is updated with the given text.
   * Same centralization rationale as updateFolderStatus.
   */
  it('updates save-status text when element exists', () => {
    setupMinimalDOM();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span id="save-status"></span>'
    );
    initUI(createMockCallbacks());

    updateSaveStatus('✅ session.zip');

    const el = document.getElementById('save-status');
    expect(el?.textContent).toBe('✅ session.zip');
  });

  /**
   * Why this test matters:
   * Graceful degradation — no crash when the element is missing.
   */
  it('does not throw when save-status element is missing', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    expect(() => updateSaveStatus('test')).not.toThrow();
  });
});

describe('updateGpsInfo', () => {
  beforeEach(() => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
  });

  /**
   * Why this test matters:
   * Verifies GPS accuracy is displayed with correct formatting.
   */
  it('shows GPS accuracy with correct formatting', () => {
    updateGpsInfo(5.5);

    const gpsAccuracy = document.getElementById('gps-accuracy');
    expect(gpsAccuracy?.textContent).toBe('±5.5m');
  });

  /**
   * Why this test matters:
   * Verifies color coding for good accuracy (green < 10m).
   */
  it('uses green color for good accuracy', () => {
    updateGpsInfo(5);

    const gpsAccuracy = document.getElementById('gps-accuracy');
    expect(gpsAccuracy?.className).toBe('text-green-400');
  });

  /**
   * Why this test matters:
   * Verifies color coding for moderate accuracy (yellow 10-30m).
   */
  it('uses yellow color for moderate accuracy', () => {
    updateGpsInfo(15);

    const gpsAccuracy = document.getElementById('gps-accuracy');
    expect(gpsAccuracy?.className).toBe('text-yellow-400');
  });

  /**
   * Why this test matters:
   * Verifies color coding for poor accuracy (red > 30m).
   */
  it('uses red color for poor accuracy', () => {
    updateGpsInfo(50);

    const gpsAccuracy = document.getElementById('gps-accuracy');
    expect(gpsAccuracy?.className).toBe('text-red-400');
  });
});

describe('updateArInfo', () => {
  /**
   * Why this test matters:
   * Verifies AR tracking status is displayed correctly.
   */
  it('shows AR tracking status', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    updateArInfo('Tracking');

    const arTracking = document.getElementById('ar-tracking');
    expect(arTracking?.textContent).toBe('Tracking');
  });
});

describe('updateFrameCount', () => {
  /**
   * Why this test matters:
   * The live frame counter gives the user immediate feedback during recording
   * that image capture is working. If this display breaks, video frame capture
   * issues become invisible (the root cause of Issue 5 user report).
   */
  it('shows frame count and unhides the container', () => {
    setupMinimalDOM();

    updateFrameCount(42);

    const info = document.getElementById('frame-count-info');
    const count = document.getElementById('frame-count');
    expect(info?.classList.contains('hidden')).toBe(false);
    expect(count?.textContent).toBe('42');
  });

  it('shows yellow color when count is 0', () => {
    setupMinimalDOM();

    updateFrameCount(0);

    const count = document.getElementById('frame-count');
    expect(count?.className).toBe('text-yellow-400');
  });

  it('shows green color when count is positive', () => {
    setupMinimalDOM();

    updateFrameCount(1);

    const count = document.getElementById('frame-count');
    expect(count?.className).toBe('text-green-400');
  });
});

describe('hideFrameCount', () => {
  /**
   * Why this test matters:
   * Frame counter should be hidden when recording stops to avoid
   * showing stale data on the summary or setup screens.
   */
  it('hides the frame count container', () => {
    setupMinimalDOM();
    // First show it
    updateFrameCount(10);
    expect(
      document.getElementById('frame-count-info')?.classList.contains('hidden')
    ).toBe(false);

    hideFrameCount();

    expect(
      document.getElementById('frame-count-info')?.classList.contains('hidden')
    ).toBe(true);
  });
});

describe('showError', () => {
  /**
   * Why this test matters:
   * Verifies error messages are displayed with red styling.
   */
  it('shows error with red styling', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    showError('Connection failed');

    const statusText = document.getElementById('status-text');
    expect(statusText?.textContent).toBe('Connection failed');
    expect(statusText?.className).toBe('text-red-400');
  });

  /**
   * Why this test matters:
   * Verifies WebXR-specific errors trigger the warning element.
   */
  it('shows webxr warning for WebXR errors', () => {
    setupMinimalDOM();
    document.body.innerHTML += '<p id="webxr-warning" class="hidden"></p>';
    initUI(createMockCallbacks());

    showError('WebXR not supported');

    const warning = document.getElementById('webxr-warning');
    expect(warning?.textContent).toBe('WebXR not supported');
    expect(warning?.classList.contains('hidden')).toBe(false);
  });

  /**
   * Why this test matters:
   * Verifies scenario dropdown change triggers onScenarioChange callback
   * (except when selecting "__new__" which shows new scenario input).
   */
  it('invokes onScenarioChange when existing scenario is selected', () => {
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);
    try {
      const mockCallbacks = createMockCallbacks();
      initUI(mockCallbacks);

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Select an existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      expect(mockCallbacks.onScenarioChange).toHaveBeenCalledWith(
        'TestScenario'
      );
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * Verifies selecting "__new__" does NOT trigger onScenarioChange.
   */
  it('does not invoke onScenarioChange when __new__ is selected', () => {
    setupMinimalDOM();
    const mockCallbacks = createMockCallbacks();
    initUI(mockCallbacks);

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    scenarioSelect.innerHTML = `
      <option value="__new__">+ New scenario</option>
      <option value="TestScenario">TestScenario</option>
    `;

    // Select "__new__"
    scenarioSelect.value = '__new__';
    scenarioSelect.dispatchEvent(new Event('change'));

    expect(mockCallbacks.onScenarioChange).not.toHaveBeenCalled();
  });

  /**
   * Why this test matters:
   * Verifies selecting "__new__" auto-focuses the scenario name input.
   * This improves UX by guiding users to the next required action.
   */
  it('auto-focuses new scenario name input when __new__ is selected', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const scenarioSelect = document.getElementById(
      'scenario-select'
    ) as HTMLSelectElement;
    const newScenarioName = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement;

    scenarioSelect.innerHTML = `
      <option value="__new__">+ New scenario</option>
      <option value="TestScenario">TestScenario</option>
    `;

    // Select "__new__"
    scenarioSelect.value = '__new__';
    scenarioSelect.dispatchEvent(new Event('change'));

    expect(document.activeElement).toBe(newScenarioName);
  });

  /**
   * Why this test matters:
   * Regression test for transitionend-based hiding. When switching from
   * __new__ to an existing scenario, the new-scenario-section should NOT
   * get 'hidden' class immediately - it waits for transitionend event.
   * This decouples JS timing from CSS transition duration.
   */
  it('does not hide new-scenario-section immediately when switching to existing scenario', () => {
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);
    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // First show the new-scenario-section by selecting __new__
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Verify it's visible (not hidden)
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);

      // Now switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // The section should NOT be hidden immediately (waits for transitionend)
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);
      // But opacity classes should be updated immediately
      expect(newScenarioSection.classList.contains('opacity-0')).toBe(true);
      expect(newScenarioSection.classList.contains('opacity-100')).toBe(false);
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * Verifies that when transitionend fires, the hidden class IS added.
   * This completes the transition-based hiding flow.
   */
  it('hides new-scenario-section after transitionend event', () => {
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);
    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // First show the new-scenario-section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Simulate CSS transition completing
      newScenarioSection.dispatchEvent(new Event('transitionend'));

      // Now the section should be hidden
      expect(newScenarioSection.classList.contains('hidden')).toBe(true);
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * Edge case: if user switches back to __new__ mid-transition,
   * the section should NOT be hidden when transitionend fires.
   * The guard condition prevents premature hiding.
   */
  it('does not hide new-scenario-section if user switches back to __new__ mid-transition', () => {
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);
    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Show the section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Switch to existing scenario (starts fade-out)
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // User changes their mind - switch back to __new__ before transition ends
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Now the first transitionend fires (from the fade-out)
      newScenarioSection.dispatchEvent(new Event('transitionend'));

      // Section should NOT be hidden because dropdown is back to __new__
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * When prefers-reduced-motion is enabled, CSS transitions may not run,
   * so transitionend events won't fire. The hidden class must be added
   * immediately to ensure the element is properly hidden from assistive tech.
   */
  it('hides new-scenario-section immediately when prefers-reduced-motion is enabled', () => {
    setupMinimalDOM();
    // Mock with hasTransition=false due to reduced motion preference
    const cleanupMocks = mockTransitionBehavior(false, true);

    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Show the section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);

      // Switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // With reduced motion, hidden should be added immediately (no waiting for transitionend)
      expect(newScenarioSection.classList.contains('hidden')).toBe(true);
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * When CSS transition duration is 0s (e.g., overridden styles), transitionend
   * won't fire. The hidden class must be added immediately.
   */
  it('hides new-scenario-section immediately when transitionDuration is 0s', () => {
    setupMinimalDOM();
    // Mock with hasTransition=false (0s duration)
    const cleanupMocks = mockTransitionBehavior(false);

    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Show the section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // With 0s duration, hidden should be added immediately
      expect(newScenarioSection.classList.contains('hidden')).toBe(true);
    } finally {
      cleanupMocks();
    }
  });

  /**
   * Why this test matters:
   * Even when transitions are expected, if transitionend never fires (browser bug,
   * rapid DOM changes, etc.), a timeout fallback ensures the element gets hidden.
   * This guards against the element remaining accessible to assistive tech.
   */
  it('hides new-scenario-section via timeout fallback if transitionend never fires', async () => {
    vi.useFakeTimers();
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);

    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Show the section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Not hidden immediately (waiting for transition)
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);

      // Don't dispatch transitionend - simulate it never firing
      // Advance timers past the fallback timeout (350ms > 300ms transition)
      await vi.advanceTimersByTimeAsync(350);

      // Should now be hidden via timeout fallback
      expect(newScenarioSection.classList.contains('hidden')).toBe(true);
    } finally {
      cleanupMocks();
      vi.useRealTimers();
    }
  });

  /**
   * Why this test matters:
   * When transitionend fires normally, the timeout fallback should be cleared
   * to avoid duplicate hidden class additions or unexpected behavior.
   */
  it('clears timeout fallback when transitionend fires normally', async () => {
    vi.useFakeTimers();
    setupMinimalDOM();
    const cleanupMocks = mockTransitionBehavior(true);

    try {
      initUI(createMockCallbacks());

      const scenarioSelect = document.getElementById(
        'scenario-select'
      ) as HTMLSelectElement;
      const newScenarioSection = document.getElementById(
        'new-scenario-section'
      )!;

      scenarioSelect.innerHTML = `
        <option value="__new__">+ New scenario</option>
        <option value="TestScenario">TestScenario</option>
      `;

      // Show the section
      scenarioSelect.value = '__new__';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Switch to existing scenario
      scenarioSelect.value = 'TestScenario';
      scenarioSelect.dispatchEvent(new Event('change'));

      // Simulate transitionend firing at 300ms
      await vi.advanceTimersByTimeAsync(300);
      newScenarioSection.dispatchEvent(new Event('transitionend'));

      expect(newScenarioSection.classList.contains('hidden')).toBe(true);

      // Remove the class to verify timeout doesn't re-add it
      newScenarioSection.classList.remove('hidden');

      // Advance past the fallback timeout
      await vi.advanceTimersByTimeAsync(100);

      // Timeout should have been cleared, so hidden should still be removed
      expect(newScenarioSection.classList.contains('hidden')).toBe(false);
    } finally {
      cleanupMocks();
      vi.useRealTimers();
    }
  });
});

describe('hideRecordingControls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Why this test matters:
   * Verifies the recording indicator is hidden when recording stops.
   * This tests the cached element is correctly used.
   */
  it('hides the recording indicator', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const indicator = document.getElementById('recording-indicator')!;
    // Simulate it being visible (as if recording was active)
    indicator.classList.remove('hidden');

    hideRecordingControls();

    expect(indicator.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * Verifies btn-start is shown and btn-stop/btn-ref-point are hidden.
   */
  it('shows start button and hides stop/ref-point buttons', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const btnStart = document.getElementById('btn-start')!;
    const btnStop = document.getElementById('btn-stop')!;
    const btnRefPoint = document.getElementById('btn-ref-point')!;

    // Simulate recording state
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    btnRefPoint.classList.remove('hidden');

    hideRecordingControls();

    expect(btnStart.classList.contains('hidden')).toBe(false);
    expect(btnStop.classList.contains('hidden')).toBe(true);
    expect(btnRefPoint.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * Ensures proper initialization order is enforced.
   * Calling hideRecordingControls before initUI is a programming error.
   */
  it('throws when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    // Import fresh module without cached state
    const { hideRecordingControls: freshHideRecordingControls } =
      await import('./hud.js');

    expect(() => freshHideRecordingControls()).toThrow('called before initUI');
  });
});

/**
 * Tests for setStopButtonBusy.
 *
 * UI feedback for async actions (CLAUDE.md): stopping a recording runs a
 * multi-second final sync. The Stop button must move to a distinguishable
 * in-progress state (disabled + relabelled + aria-busy) while that work runs,
 * and return to its idle state for the next recording. This is the feedback
 * that removes the double-tap which caused Sentry issue 7319627943.
 */
describe('setStopButtonBusy', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('disables, relabels and marks the Stop button busy', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
    btnStop.textContent = '⏹ Stop';

    setStopButtonBusy(true);

    expect(btnStop.hasAttribute('disabled')).toBe(true);
    expect(btnStop.getAttribute('aria-busy')).toBe('true');
    // Label must visibly change so the user sees the action was registered.
    expect(btnStop.textContent).not.toBe('⏹ Stop');
    expect(btnStop.textContent?.toLowerCase()).toContain('stopping');
  });

  it('restores the idle Stop button state', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;

    setStopButtonBusy(true);
    setStopButtonBusy(false);

    expect(btnStop.hasAttribute('disabled')).toBe(false);
    expect(btnStop.getAttribute('aria-busy')).toBe('false');
    expect(btnStop.textContent).toBe('⏹ Stop');
  });

  /**
   * Why this test matters: a new recording must start with a clean (enabled,
   * "Stop") button even if the prior stop left it in the busy state.
   */
  it('is reset to idle by showRecordingControls', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
    setStopButtonBusy(true);

    showRecordingControls();

    expect(btnStop.hasAttribute('disabled')).toBe(false);
    expect(btnStop.getAttribute('aria-busy')).toBe('false');
    expect(btnStop.textContent).toBe('⏹ Stop');
  });

  it('throws when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { setStopButtonBusy: freshSetStopButtonBusy } =
      await import('./hud.js');

    expect(() => freshSetStopButtonBusy(true)).toThrow('called before initUI');
  });
});

/**
 * Tests for showArReadyControls function.
 *
 * Issue #2 fix: When entering AR (AR_READY state), we should show the Start button,
 * NOT the Stop button. The Stop button should only appear when recording is active.
 *
 * See: docs/2026-01-25-user-feedback.md#issue-2
 * See: README.md#application-state-machine
 */
describe('showArReadyControls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Why this test matters:
   * When entering AR_READY state, the Start Recording button should be visible
   * so the user can explicitly choose when to begin recording.
   * This addresses Issue #2: "Contradictory UI State"
   */
  it('shows the start button in AR_READY state', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { initUI: freshInitUI, showArReadyControls } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    const btnStart = document.getElementById('btn-start')!;
    // Initially hidden (from initial DOM state)
    btnStart.classList.add('hidden');

    showArReadyControls();

    expect(btnStart.classList.contains('hidden')).toBe(false);
  });

  /**
   * Why this test matters:
   * The Stop button should NOT be shown when entering AR.
   * It should only appear after the user clicks Start Recording.
   */
  it('hides the stop button in AR_READY state', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { initUI: freshInitUI, showArReadyControls } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    const btnStop = document.getElementById('btn-stop')!;
    // Ensure it's visible before calling
    btnStop.classList.remove('hidden');

    showArReadyControls();

    expect(btnStop.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * The recording indicator (pulsing red dot) should NOT be shown when entering AR.
   * It suggests active recording, which is misleading in AR_READY state.
   */
  it('hides the recording indicator in AR_READY state', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { initUI: freshInitUI, showArReadyControls } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    const indicator = document.getElementById('recording-indicator')!;
    // Ensure it's visible before calling
    indicator.classList.remove('hidden');

    showArReadyControls();

    expect(indicator.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * The reference point button should NOT be shown in AR_READY state.
   * Marking ref points only makes sense during an active recording.
   */
  it('hides the reference point button in AR_READY state', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { initUI: freshInitUI, showArReadyControls } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    const btnRefPoint = document.getElementById('btn-ref-point')!;
    // Ensure it's visible before calling
    btnRefPoint.classList.remove('hidden');

    showArReadyControls();

    expect(btnRefPoint.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * Ensures proper initialization order is enforced.
   */
  it('throws when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { showArReadyControls } = await import('./hud.js');

    expect(() => showArReadyControls()).toThrow('called before initUI');
  });
});

describe('updateSyncStatus', () => {
  /**
   * Helper to set up DOM with sync status elements.
   */
  function setupDOMWithSyncStatus(): void {
    setupMinimalDOM();
    // Add sync status elements
    const hud = document.createElement('div');
    hud.innerHTML = `
      <div id="sync-info" class="hidden">
        <span id="sync-status">--</span>
      </div>
    `;
    document.body.appendChild(hud);
  }

  /**
   * Why this test matters:
   * When sync is active and working, the user should see last sync time.
   */
  it('displays last sync time when sync is successful', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now() - 30_000, // 30 seconds ago
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    const syncStatus = document.getElementById('sync-status')!;

    expect(syncInfo.classList.contains('hidden')).toBe(false);
    expect(syncStatus.textContent).toContain('30s ago');
    expect(syncStatus.classList.contains('text-green-400')).toBe(true);
  });

  /**
   * Why this test matters:
   * When sync fails, the user should see an error indicator.
   */
  it('displays error message when sync fails', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now() - 60_000,
      lastError: 'Write failed',
    });

    const syncStatus = document.getElementById('sync-status')!;

    expect(syncStatus.textContent).toContain('⚠️');
    expect(syncStatus.classList.contains('text-yellow-400')).toBe(true);
  });

  /**
   * Why this test matters:
   * When sync is idle, the UI should be hidden.
   */
  it('hides sync info when state is idle', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    // First show it
    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now(),
      lastError: null,
    });

    // Then set to idle
    updateSyncStatus({
      state: 'idle',
      lastSyncTime: null,
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    expect(syncInfo.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * When never synced, should show pending indicator.
   */
  it('shows pending when active but never synced', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    updateSyncStatus({
      state: 'active',
      lastSyncTime: null,
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    const syncStatus = document.getElementById('sync-status')!;

    expect(syncInfo.classList.contains('hidden')).toBe(false);
    expect(syncStatus.textContent).toContain('pending');
  });

  // Bug 3 (SPA audit): The relative time display ("30s ago") must tick forward
  // even without new sync events. Currently it freezes at the value computed
  // when updateSyncStatus was last called.
  it('should refresh relative time periodically without new sync calls', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    const syncTime = Date.now();
    updateSyncStatus({
      state: 'active',
      lastSyncTime: syncTime,
      lastError: null,
    });

    const syncStatus = document.getElementById('sync-status')!;
    expect(syncStatus.textContent).toBe('0s ago');

    // Advance 30 seconds (3 refresh intervals) — no new sync event fires
    vi.advanceTimersByTime(30_000);

    expect(syncStatus.textContent).toBe('30s ago');

    vi.useRealTimers();
  });

  // Bug 3: Timer must be cleaned up when sync becomes idle
  it('should stop relative time refresh when state is idle', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    setupDOMWithSyncStatus();

    const { initUI: freshInitUI, updateSyncStatus } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now(),
      lastError: null,
    });

    // Go idle — should stop the timer
    updateSyncStatus({
      state: 'idle',
      lastSyncTime: null,
      lastError: null,
    });

    // Advance time — should not throw or cause issues
    vi.advanceTimersByTime(30_000);

    const syncInfo = document.getElementById('sync-info')!;
    expect(syncInfo.classList.contains('hidden')).toBe(true);

    vi.useRealTimers();
  });
});

// ============================================================================
// showSetupModal Tests (Issue 4 — soft reset for new recording)
// ============================================================================

describe('showSetupModal', () => {
  // Why this test matters: The soft reset must return the UI to the SETUP
  // screen by showing the setup modal that was hidden when entering AR.
  it('removes hidden class from setup-modal', async () => {
    vi.resetModules();
    setupMinimalDOM();
    const modal = document.getElementById('setup-modal')!;
    modal.classList.add('hidden');

    const { initUI: freshInitUI, showSetupModal } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    showSetupModal();

    expect(modal.classList.contains('hidden')).toBe(false);
  });

  // Why this test matters: When returning to setup, recording controls must
  // be hidden and the session summary panel must also be hidden.
  it('is safe to call when modal is already visible', async () => {
    vi.resetModules();
    setupMinimalDOM();
    const modal = document.getElementById('setup-modal')!;
    // Not hidden — already visible
    expect(modal.classList.contains('hidden')).toBe(false);

    const { initUI: freshInitUI, showSetupModal } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    // Should not throw
    showSetupModal();
    expect(modal.classList.contains('hidden')).toBe(false);
  });
});

// ============================================================================
// resetUIForNewRecording Tests (Issue 4 — soft reset for new recording)
// ============================================================================

describe('resetUIForNewRecording', () => {
  // Why this test matters: On soft reset, save location must be cleared
  // (new recording = new ZIP), but folder selection is kept if read handle persists.
  it('clears saveLocationSelected but preserves folderSelected when keepFolder=true', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const {
      initUI: freshInitUI,
      setFolderSelected: freshSetFolder,
      setSaveLocationSelected: freshSetSave,
      getFolderSelected: freshGetFolder,
      getSaveLocationSelected: freshGetSave,
      resetUIForNewRecording,
    } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    freshSetFolder(true);
    freshSetSave(true);

    resetUIForNewRecording({ keepFolder: true });

    expect(freshGetFolder()).toBe(true);
    expect(freshGetSave()).toBe(false);
  });

  // Why this test matters: If the read folder handle is no longer valid,
  // both folder and save location must be reset.
  it('clears both folderSelected and saveLocationSelected when keepFolder=false', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const {
      initUI: freshInitUI,
      setFolderSelected: freshSetFolder,
      setSaveLocationSelected: freshSetSave,
      getFolderSelected: freshGetFolder,
      getSaveLocationSelected: freshGetSave,
      resetUIForNewRecording,
    } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    freshSetFolder(true);
    freshSetSave(true);

    resetUIForNewRecording({ keepFolder: false });

    expect(freshGetFolder()).toBe(false);
    expect(freshGetSave()).toBe(false);
  });

  // Why this test matters: The setup modal must be shown and recording controls
  // hidden so the user sees the configuration screen.
  it('shows setup modal and hides recording controls', async () => {
    vi.resetModules();
    setupMinimalDOM();
    const modal = document.getElementById('setup-modal')!;
    modal.classList.add('hidden');

    const { initUI: freshInitUI, resetUIForNewRecording } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    resetUIForNewRecording({ keepFolder: false });

    expect(modal.classList.contains('hidden')).toBe(false);
    // Start/stop/ref buttons should be hidden
    expect(
      document.getElementById('btn-start')!.classList.contains('hidden')
    ).toBe(true);
    expect(
      document.getElementById('btn-stop')!.classList.contains('hidden')
    ).toBe(true);
    expect(
      document.getElementById('btn-ref-point')!.classList.contains('hidden')
    ).toBe(true);
  });

  // Why this test matters: The save status text should be cleared since the
  // user needs to choose a new save location for the new recording.
  it('resets save status text', async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <button id="btn-enter-ar" disabled></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop" class="hidden"></button>
      <button id="btn-ref-point" class="hidden"></button>
      <button id="btn-new-ref-point" class="hidden"></button>
      <div id="setup-modal" class="hidden"></div>
      <div id="new-scenario-section" class="hidden"></div>
      <input id="new-scenario-name" type="text" />
      <span id="status-text"></span>
      <div id="gps-info" class="hidden"><span id="gps-accuracy"></span></div>
      <div id="ar-info" class="hidden"><span id="ar-tracking"></span></div>
      <textarea id="session-notes" disabled></textarea>
      <div id="recording-indicator" class="hidden"></div>
      <p id="enter-ar-hint"></p>
      <span id="save-status">✅ old-file.zip</span>
      <span id="folder-status">✅ MyFolder (5 ref pts)</span>
    `;

    const { initUI: freshInitUI, resetUIForNewRecording } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    resetUIForNewRecording({ keepFolder: true });

    // Save status should be cleared
    expect(document.getElementById('save-status')!.textContent).toBe('');
    // Folder status should be preserved when keepFolder=true
    expect(document.getElementById('folder-status')!.textContent).toContain(
      'MyFolder'
    );
  });

  // Why this test matters: When folder is not kept, the folder status text
  // should also be cleared so the UI matches the state.
  it('resets folder status text when keepFolder=false', async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <button id="btn-enter-ar" disabled></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop" class="hidden"></button>
      <button id="btn-ref-point" class="hidden"></button>
      <button id="btn-new-ref-point" class="hidden"></button>
      <div id="setup-modal" class="hidden"></div>
      <div id="new-scenario-section" class="hidden"></div>
      <input id="new-scenario-name" type="text" />
      <span id="status-text"></span>
      <div id="gps-info" class="hidden"><span id="gps-accuracy"></span></div>
      <div id="ar-info" class="hidden"><span id="ar-tracking"></span></div>
      <textarea id="session-notes" disabled></textarea>
      <div id="recording-indicator" class="hidden"></div>
      <p id="enter-ar-hint"></p>
      <span id="save-status">✅ old-file.zip</span>
      <span id="folder-status">✅ MyFolder (5 ref pts)</span>
    `;

    const { initUI: freshInitUI, resetUIForNewRecording } =
      await import('./hud.js');
    freshInitUI(createMockCallbacks());

    resetUIForNewRecording({ keepFolder: false });

    expect(document.getElementById('save-status')!.textContent).toBe('');
    expect(document.getElementById('folder-status')!.textContent).toBe('');
  });
});

/**
 * Tests for updateRefPointButtonLabel.
 *
 * Why these tests matter:
 * During live recording, the ref point button label should change dynamically
 * to show the name of a nearby known ref point (H3 proximity detection).
 * See: docs/2026-03-21-live-ref-point-button-plan.md, Change A.
 */
describe('updateRefPointButtonLabel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Why this test matters:
   * When the user walks near a known ref point, the button should show
   * the ref point name so they can capture it with a single tap.
   */
  it('sets button text to capture label when given a ref point name', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    updateRefPointButtonLabel('Bank');

    const btn = document.getElementById('btn-ref-point')!;
    expect(btn.textContent).toBe("📍 Capture 'Bank'");
  });

  /**
   * Why this test matters:
   * When the user moves away from known ref points, the button should
   * revert to the default label for marking new points.
   */
  it('resets button text to default when called with undefined', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    // First set a name, then clear it
    updateRefPointButtonLabel('Bank');
    updateRefPointButtonLabel(undefined);

    const btn = document.getElementById('btn-ref-point')!;
    expect(btn.textContent).toBe('📍 Mark Point');
  });

  /**
   * Why this test matters:
   * Safety — calling before initUI should not throw (no cachedElements).
   */
  it('is a no-op when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { updateRefPointButtonLabel: freshFn } = await import('./hud.js');

    // Should not throw
    expect(() => freshFn('Bank')).not.toThrow();
  });
});

/**
 * Tests for ref point button label reset when recording stops.
 *
 * Why these tests matter:
 * When recording stops (showArReadyControls / hideRecordingControls),
 * the ref point button label must reset to the default "📍 Mark Point"
 * so the next recording session starts with a clean state.
 * See: docs/2026-03-21-live-ref-point-button-plan.md, Change D.
 */
describe('showArReadyControls resets ref point button label', () => {
  /**
   * Why this test matters:
   * If the user was near a known ref point when recording stopped,
   * the next time the button is shown it should not carry over the
   * old proximity label.
   */
  it('resets ref point button label to default', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const {
      initUI: freshInitUI,
      showArReadyControls,
      updateRefPointButtonLabel: freshUpdate,
    } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    // Simulate proximity label was set during recording
    freshUpdate('Bank');
    const btn = document.getElementById('btn-ref-point')!;
    expect(btn.textContent).toBe("📍 Capture 'Bank'");

    // Transition to AR_READY state (recording stopped)
    showArReadyControls();

    expect(btn.textContent).toBe('📍 Mark Point');
  });
});

// ---------------------------------------------------------------------------
// Map zoom button wiring
// ---------------------------------------------------------------------------

describe('hud zoom buttons', () => {
  beforeEach(() => {
    setupMinimalDOM();
  });

  /**
   * Why this test matters:
   * Zoom in/out buttons next to the map toggle allow users to control map
   * zoom level via the HUD, since native pinch-to-zoom is blocked by
   * pointer-events: none on the CSS3DRenderer wrapper.
   */
  it('should call onMapZoomIn when btn-map-zoom-in is clicked', () => {
    // Add zoom buttons to DOM
    const zoomIn = document.createElement('button');
    zoomIn.id = 'btn-map-zoom-in';
    document.body.appendChild(zoomIn);

    const cbs = createMockCallbacks();
    initUI(cbs);

    zoomIn.click();
    expect(cbs.onMapZoomIn).toHaveBeenCalledOnce();
  });

  it('should call onMapZoomOut when btn-map-zoom-out is clicked', () => {
    const zoomOut = document.createElement('button');
    zoomOut.id = 'btn-map-zoom-out';
    document.body.appendChild(zoomOut);

    const cbs = createMockCallbacks();
    initUI(cbs);

    zoomOut.click();
    expect(cbs.onMapZoomOut).toHaveBeenCalledOnce();
  });

  /**
   * Why this test matters:
   * Zoom buttons are optional — app must work without them in the DOM.
   */
  it('should not throw when zoom buttons are missing from DOM', () => {
    const cbs = createMockCallbacks();
    expect(() => initUI(cbs)).not.toThrow();
  });
});
// ============================================================================
// Bug 1: Enter AR error must not hide setup modal (SPA audit 2026-04-06)
// ============================================================================

describe('Enter AR error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    setupMinimalDOM();
  });

  // Why: If AR init fails (no WebXR, denied camera), the setup modal must
  // remain visible so the user can retry. Hiding it prematurely traps the
  // user on a blank screen with no way back.
  it('should keep setup modal visible when onEnterAR rejects', async () => {
    const callbacks = createMockCallbacks();
    callbacks.onEnterAR = vi
      .fn()
      .mockRejectedValue(new Error('WebXR not supported'));

    const { initUI: freshInitUI } = await import('./hud.js');
    freshInitUI(callbacks);

    const btn = document.getElementById('btn-enter-ar') as HTMLButtonElement;
    btn.disabled = false; // simulate validated state
    btn.click();

    await vi.waitFor(() => {
      expect(callbacks.onEnterAR).toHaveBeenCalledOnce();
    });

    // Allow the rejected promise chain to settle
    await new Promise((r) => setTimeout(r, 0));

    const modal = document.getElementById('setup-modal')!;
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  // Why: When AR succeeds, the modal should be hidden and AR controls shown.
  it('should hide setup modal only after onEnterAR resolves', async () => {
    const callbacks = createMockCallbacks();
    callbacks.onEnterAR = vi.fn().mockResolvedValue(undefined);

    const { initUI: freshInitUI } = await import('./hud.js');
    freshInitUI(callbacks);

    const btn = document.getElementById('btn-enter-ar') as HTMLButtonElement;
    btn.disabled = false; // simulate validated state
    btn.click();

    await vi.waitFor(() => {
      expect(callbacks.onEnterAR).toHaveBeenCalledOnce();
    });

    // Allow the resolved promise chain to settle
    await new Promise((r) => setTimeout(r, 0));

    const modal = document.getElementById('setup-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

// ============================================================================
// setNewRefPointButtonVisible (Part B — proximity + button, 2026-04-18)
// ============================================================================

/**
 * Tests for the secondary "+" button next to the ref point button.
 *
 * Why these tests matter:
 * When the user is in a neighboring H3 cell of an existing ref point
 * (inside gridDisk but different center cell), a small "+" button should
 * appear allowing them to create a new ref point at the current location.
 * This complements the primary button which re-observes the nearby point.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
describe('setNewRefPointButtonVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Why: When the user is in a neighbor cell, the + button should become visible.
  it('shows btn-new-ref-point when called with true', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    setNewRefPointButtonVisible(true);

    const btn = document.getElementById('btn-new-ref-point')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  // Why: When the user leaves the neighbor cell zone, the + button hides.
  it('hides btn-new-ref-point when called with false', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    // First show it, then hide it
    setNewRefPointButtonVisible(true);
    setNewRefPointButtonVisible(false);

    const btn = document.getElementById('btn-new-ref-point')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  // Why: The + button must start hidden (default state in HTML).
  it('starts hidden by default', () => {
    setupMinimalDOM();
    initUI(createMockCallbacks());

    const btn = document.getElementById('btn-new-ref-point')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  // Why: Safety — calling before initUI should not throw.
  it('is a no-op when called before initUI', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const { setNewRefPointButtonVisible: freshFn } = await import('./hud.js');

    expect(() => freshFn(true)).not.toThrow();
  });

  // Why: When recording stops (AR_READY state), the + button must be hidden
  // along with the primary ref point button.
  it('is hidden by showArReadyControls', async () => {
    vi.resetModules();
    setupMinimalDOM();

    const {
      initUI: freshInitUI,
      setNewRefPointButtonVisible: freshSetVisible,
      showArReadyControls,
    } = await import('./hud.js');
    freshInitUI(createMockCallbacks());

    // Make it visible first
    freshSetVisible(true);
    const btn = document.getElementById('btn-new-ref-point')!;
    expect(btn.classList.contains('hidden')).toBe(false);

    // Transition to AR_READY state
    showArReadyControls();
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  // Why: Clicking the + button should call onMarkNewRefPoint to trigger
  // handleMarkRefPoint({ forceNew: true }) via main.ts wiring.
  it('calls onMarkNewRefPoint when btn-new-ref-point is clicked', () => {
    setupMinimalDOM();
    const cbs = createMockCallbacks();
    initUI(cbs);

    const btn = document.getElementById('btn-new-ref-point')!;
    btn.click();
    expect(cbs.onMarkNewRefPoint).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for updatePermissionStatus — the "Grant Permissions" button must
 * stay visible (and show explanatory red text) until every mandatory
 * permission reports granted === true, including when a permission is
 * denied. See docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md
 * (Issue 2) for the full design.
 */
describe('updatePermissionStatus — Grant Permissions button visibility', () => {
  function setupPermissionDOM(): void {
    document.body.innerHTML = `
      <button id="btn-enter-ar" disabled></button>
      <select id="scenario-select"></select>
      <button id="btn-start"></button>
      <button id="btn-stop" class="hidden"></button>
      <button id="btn-ref-point" class="hidden"></button>
      <button id="btn-new-ref-point" class="hidden"></button>
      <button id="btn-map"></button>
      <button id="btn-open-folder"></button>
      <button id="btn-choose-save"></button>
      <div id="setup-modal"></div>
      <div id="new-scenario-section" class="hidden"></div>
      <input id="new-scenario-name" type="text" />
      <span id="status-text"></span>
      <div id="gps-info" class="hidden"><span id="gps-accuracy"></span></div>
      <div id="ar-info" class="hidden"><span id="ar-tracking"></span></div>
      <div id="frame-count-info" class="hidden"><span id="frame-count">0</span></div>
      <textarea id="session-notes" disabled></textarea>
      <div id="recording-indicator" class="hidden"></div>
      <p id="enter-ar-hint"></p>
      <span id="perm-filestorage-status"></span>
      <span id="perm-webxr-status"></span>
      <span id="perm-gps-status"></span>
      <span id="perm-camera-status"></span>
      <!-- No #perm-orientation-status: the Compass row was removed in D3
           (2026-06-19). This fixture mirrors the production DOM so the
           permission-status update is exercised exactly as it ships. -->
      <button id="btn-request-permissions" class="hidden">Grant Permissions</button>
      <p id="permission-error" class="hidden"></p>
    `;
  }

  function makeResult(
    overrides: Partial<{
      webxr: boolean | null;
      geolocation: boolean | null;
      camera: boolean | null;
      orientation: boolean | null;
    }> = {}
  ): PermissionCheckResult {
    // Use `in` checks so explicit `null` overrides aren't coerced by `??`.
    const xr = 'webxr' in overrides ? overrides.webxr! : true;
    const geo = 'geolocation' in overrides ? overrides.geolocation! : true;
    const cam = 'camera' in overrides ? overrides.camera! : true;
    const ori = 'orientation' in overrides ? overrides.orientation! : true;
    return {
      webxr: {
        supported: true,
        granted: xr,
        error: xr === false ? 'AR access denied.' : undefined,
      },
      geolocation: {
        supported: true,
        granted: geo,
        error: geo === false ? 'Location access denied.' : undefined,
      },
      camera: {
        supported: true,
        granted: cam,
        error: cam === false ? 'Camera access denied.' : undefined,
      },
      orientation: { supported: true, granted: ori },
      fileSystem: { supported: true, granted: true },
      // Mirrors allMandatoryReady in permission-checker.ts: WebXR + Location +
      // Camera (+ FileSystem, always true here). Compass is excluded.
      allMandatoryReady: xr === true && geo === true && cam === true,
    };
  }

  // Why: When a permission flips to denied, the user must still have an
  // in-app way to re-trigger the request after flipping the setting back in
  // the browser. The old logic (granted === null) hid the button on denial.
  it('keeps button visible when geolocation is denied (granted === false)', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ geolocation: false }));

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  // Why: Same rule applied symmetrically — camera-denied must not hide the
  // button either, otherwise the user gets stuck in a dead-end.
  it('keeps button visible when camera is denied', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ camera: false }));

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  // Why: When everything is granted the button has nothing to do and must
  // disappear — the original visibility contract for the happy path.
  it('hides button once all mandatory permissions are granted', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult());

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  // Why: The button must also be visible in the initial "never asked"
  // (granted === null) state — this regression-proofs the existing behavior
  // while broadening the rule.
  it('keeps button visible when permissions are still pending (null)', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ geolocation: null }));

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  // Why: When the button is visible because permissions are still pending
  // (not yet denied), the user should see an explanatory red message that
  // permissions are mandatory — per the design decision to keep the button
  // label generic and surface the reason in #permission-error instead.
  it('shows mandatory-permissions red text while permissions are pending', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ geolocation: null, camera: null }));

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/mandatory/i);
    expect(err.textContent).toMatch(/Location/);
    expect(err.textContent).toMatch(/Camera/);
  });

  // Why: When a permission is explicitly denied, the existing specific
  // "access denied" message must take precedence over the generic mandatory
  // hint so the user gets actionable guidance.
  it('shows specific denied message (not mandatory hint) when denied', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ geolocation: false }));

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/access denied/i);
    expect(err.textContent).not.toMatch(/mandatory/i);
  });

  // Why: Once everything is granted there is no error to show — the line
  // must collapse so the setup modal looks clean.
  it('hides permission-error when everything is granted', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult());

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(true);
  });

  // Why: WebXR is mandatory (part of allMandatoryReady in
  // permission-checker.ts) and requestAllPermissions probes it. If the user
  // denies the AR/depth probe, the button MUST stay visible so they can
  // retry — the old logic omitted WebXR entirely and hid the button,
  // dead-ending the user with an error and no recovery path.
  it('keeps button visible when WebXR is denied', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ webxr: false }));

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  // Why: When WebXR is explicitly denied (granted === false) the user gets
  // the actionable "access denied. Please enable in browser settings."
  // message — not the vague generic "mandatory" hint. WebXR denial is a real
  // state (requestWebXRWithDepthPermission returns granted:false on a
  // NotAllowedError), so AR must be in the consolidated denied list.
  it('shows specific AR-denied message (not mandatory hint) when WebXR is denied', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ webxr: false }));

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/AR/);
    expect(err.textContent).toMatch(/access denied/i);
    expect(err.textContent).not.toMatch(/mandatory/i);
  });

  // Why: While WebXR is still pending (granted === null) the mandatory hint
  // must list AR so the user understands the AR permission is required.
  it('lists AR in the mandatory hint while WebXR is pending', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ webxr: null }));

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/mandatory/i);
    expect(err.textContent).toMatch(/AR/);
  });

  // Why: Compass/orientation is NOT mandatory (excluded from
  // allMandatoryReady). When it is the only missing permission the button
  // must still show (the button requests it too), but the message must NOT
  // claim Compass access is "mandatory" — that was the incorrect messaging.
  it('keeps button visible for missing Compass without a mandatory error', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(makeResult({ orientation: null }));

    const btn = document.getElementById('btn-request-permissions')!;
    expect(btn.classList.contains('hidden')).toBe(false);

    const err = document.getElementById('permission-error')!;
    // No mandatory permission is missing, so the mandatory hint must stay
    // hidden and Compass must never be described as mandatory.
    expect(err.textContent ?? '').not.toMatch(/mandatory/i);
    expect(err.textContent ?? '').not.toMatch(/Compass/);
  });

  // Why: The mandatory hint must never include Compass even when other
  // mandatory permissions are also pending — Compass is recommended-only.
  it('excludes Compass from the mandatory hint when several are pending', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());

    updatePermissionStatus(
      makeResult({ geolocation: null, camera: null, orientation: null })
    );

    const err = document.getElementById('permission-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/mandatory/i);
    expect(err.textContent).toMatch(/Location/);
    expect(err.textContent).toMatch(/Camera/);
    expect(err.textContent).not.toMatch(/Compass/);
  });

  // Why: D3 (2026-06-19) removed the Compass row, so the production DOM has no
  // #perm-orientation-status element. updatePermissionStatus must degrade
  // gracefully — no throw — and still update the remaining rows. The shared
  // fixture above already omits the element; this test makes that contract
  // explicit so a hard (non-null-guarded) reference can't sneak back in.
  it('does not throw and still updates other rows when the orientation row is absent (D3)', () => {
    setupPermissionDOM();
    initUI(createMockCallbacks());
    expect(document.getElementById('perm-orientation-status')).toBeNull();

    expect(() => updatePermissionStatus(makeResult())).not.toThrow();

    // The remaining mandatory rows are still updated to their granted state.
    expect(document.getElementById('perm-camera-status')!.textContent).toMatch(
      /ready/i
    );
    expect(document.getElementById('perm-webxr-status')!.textContent).toMatch(
      /ready/i
    );
  });
});

// ---------------------------------------------------------------------------
// Tracking Quality indicator
// ---------------------------------------------------------------------------

import type { TrackingQualityReport } from 'gps-plus-slam-app-framework';

function makeReport(
  overrides: Partial<TrackingQualityReport> = {}
): TrackingQualityReport {
  return {
    state: 'ok',
    confidence: 0.85,
    subScores: {
      convergence: 0.9,
      residualConsensus: 0.85,
      gpsAccuracy: 0.88,
      coverage: 1.0,
    },
    diagnostics: {
      recentSumRotationDeltaDeg: 1.2,
      recentSumTranslationDeltaM: 0.5,
      medianResidualM: 2.3,
      medianRecentGpsAccuracyM: 6.0,
      walkedDistanceM: 42,
      directionSpreadDeg: 120,
      observationsSeen: 25,
      gpsVsFusedMaxDivergenceM: 3.1,
    },
    ...overrides,
  };
}

describe('updateTrackingQuality', () => {
  beforeEach(() => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
  });

  // Why: the indicator must become visible once tracking quality data arrives.
  it('unhides the tracking quality container', () => {
    updateTrackingQuality(makeReport());

    const container = document.getElementById('tracking-quality')!;
    expect(container.classList.contains('hidden')).toBe(false);
  });

  // Why: the state badge is the primary at-a-glance signal for the user.
  it('displays the state label', () => {
    updateTrackingQuality(makeReport({ state: 'ok' }));
    expect(document.getElementById('tq-state')!.textContent).toBe('OK');
  });

  // Why: numeric confidence gives users a sense of progression (0→1).
  it('displays confidence as a percentage', () => {
    updateTrackingQuality(makeReport({ confidence: 0.73 }));
    expect(document.getElementById('tq-confidence')!.textContent).toBe('73%');
  });

  // Why: color coding must match tracking state for instant recognition.
  it('applies green color for ok state', () => {
    updateTrackingQuality(makeReport({ state: 'ok' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-green-400');
  });

  it('applies yellow color for degraded state', () => {
    updateTrackingQuality(makeReport({ state: 'degraded' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-yellow-400');
  });

  it('applies gray color for warming-up state', () => {
    updateTrackingQuality(makeReport({ state: 'warming-up' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-gray-400');
  });

  it('applies red color for ar-lost state', () => {
    updateTrackingQuality(makeReport({ state: 'ar-lost' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-red-400');
  });

  // Why: the badge must toggle only its state-color class, not overwrite
  // className wholesale. A wholesale overwrite would silently drop any
  // layout/padding/font classes (and the static `cursor-pointer`) declared
  // on the element in index.html. This guards against regressing to
  // `badge.className = ...`.
  it('preserves unrelated classes when updating state color', () => {
    const badge = document.getElementById('tracking-quality-badge')!;
    // Simulate classes that index.html may add now or in the future.
    badge.classList.add('cursor-pointer', 'px-2', 'font-bold');

    updateTrackingQuality(makeReport({ state: 'ok' }));

    expect(badge.classList.contains('cursor-pointer')).toBe(true);
    expect(badge.classList.contains('px-2')).toBe(true);
    expect(badge.classList.contains('font-bold')).toBe(true);
    expect(badge.classList.contains('text-green-400')).toBe(true);
  });

  // Why: switching state must remove the previous state color, otherwise
  // stale color classes accumulate and the displayed color is undefined.
  it('removes the previous state color when state changes', () => {
    const badge = document.getElementById('tracking-quality-badge')!;

    updateTrackingQuality(makeReport({ state: 'ok' }));
    expect(badge.classList.contains('text-green-400')).toBe(true);

    updateTrackingQuality(makeReport({ state: 'ar-lost' }));
    expect(badge.classList.contains('text-green-400')).toBe(false);
    expect(badge.classList.contains('text-red-400')).toBe(true);
  });

  // Why: sub-scores must be visible in the expanded detail view.
  it('populates sub-score values in detail panel', () => {
    // Why: confirms the four sub-scores that survived the 2026-05-23
    // field-test pruning (Findings 2, 3, 5) still render. heading / obs /
    // walked were intentionally removed from the HUD; they remain on the
    // report for background metrics + tests but are no longer in the
    // detail panel. (The compass sub-score was removed entirely on
    // 2026-06-28 — it was inert dead code.)
    updateTrackingQuality(
      makeReport({
        subScores: {
          convergence: 0.91,
          residualConsensus: 0.72,
          gpsAccuracy: 0.65,
          coverage: 1.0,
        },
      })
    );

    expect(document.getElementById('tq-convergence')!.textContent).toContain(
      '91%'
    );
    expect(document.getElementById('tq-residual')!.textContent).toContain(
      '72%'
    );
    expect(document.getElementById('tq-gps-accuracy')!.textContent).toContain(
      '65%'
    );
    expect(document.getElementById('tq-coverage')!.textContent).toContain(
      '100%'
    );
  });

  // Why: Findings 2 & 3 removed compass / heading / obs / walked from the
  // HUD. Guard the deletion so a careless re-add is caught.
  it('does not render compass, heading, obs, or walked elements', () => {
    updateTrackingQuality(makeReport());
    expect(document.getElementById('tq-compass')).toBeNull();
    expect(document.getElementById('tq-heading-delta')).toBeNull();
    expect(document.getElementById('tq-compass-drift')).toBeNull();
    expect(document.getElementById('tq-obs-count')).toBeNull();
    expect(document.getElementById('tq-walked')).toBeNull();
  });

  // Why: Finding 6 — the two raw alignment-motion sums sit next to
  // `Conv:` in the HUD so the user can see *how much* and *on which
  // axis* the alignment is moving when the smoothed convergence score
  // looks suspicious. The values come straight from
  // `diagnostics.recentSum…` (no rounding to %), with 2 decimal places
  // and the °/m suffixes the user expects in the field.
  it('renders ΣΔrot and ΣΔpos sums from diagnostics (Finding 6)', () => {
    updateTrackingQuality(
      makeReport({
        diagnostics: {
          recentSumRotationDeltaDeg: 3.456,
          recentSumTranslationDeltaM: 0.789,
          medianResidualM: 2.0,
          medianRecentGpsAccuracyM: 5.0,
          walkedDistanceM: 42,
          directionSpreadDeg: 120,
          observationsSeen: 25,
          gpsVsFusedMaxDivergenceM: 3.1,
        },
      })
    );
    expect(document.getElementById('tq-sum-rot')!.textContent).toContain(
      'ΣΔrot: 3.46°'
    );
    expect(document.getElementById('tq-sum-pos')!.textContent).toContain(
      'ΣΔpos: 0.79m'
    );
  });
});

describe('tracking quality badge tap to expand/collapse', () => {
  beforeEach(() => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
  });

  // Why: details panel starts collapsed — users see the badge first.
  it('starts with details panel hidden', () => {
    updateTrackingQuality(makeReport());
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });

  // Why: tapping the badge toggles the detail panel open.
  it('expands details on badge click', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click();
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(false);
  });

  // Why: tapping again collapses the detail panel.
  it('collapses details on second badge click', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click(); // expand
    badge.click(); // collapse
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });
});

describe('hideTrackingQuality', () => {
  beforeEach(() => {
    setupMinimalDOM();
    initUI(createMockCallbacks());
  });

  // Why: tracking quality indicator should hide when recording ends
  // or when the session resets.
  it('hides the tracking quality container', () => {
    updateTrackingQuality(makeReport());
    hideTrackingQuality();
    const container = document.getElementById('tracking-quality')!;
    expect(container.classList.contains('hidden')).toBe(true);
  });

  // Why: re-showing after hide should reset expanded state.
  it('collapses details when hidden then re-shown', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click(); // expand
    hideTrackingQuality();
    updateTrackingQuality(makeReport());
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });
});

/**
 * Help-section collapse behaviour (Issue 2 / 2026-01-27, revisited 2026-06-19).
 *
 * Why these tests matter: a user reported the "What is this app?" help section
 * is "always open also on future starts of the recorder". The 2026-01-27 design
 * is open-by-default + *sticky collapse* (collapsing persists via the
 * `gps-recorder-help-collapsed` localStorage key). These tests pin the actual
 * behaviour of `initHelpSection` (driven through `initUI`, which the existing
 * `setupMinimalDOM` never exercised because it omits `#help-section`) so we can
 * tell a real persistence bug apart from a default-behaviour expectation
 * mismatch.
 */
describe('help section collapse persistence', () => {
  const HELP_COLLAPSED_KEY = 'gps-recorder-help-collapsed';
  const HELP_SEEN_KEY = 'gps-recorder-help-seen';

  beforeEach(() => {
    localStorage.clear();
  });

  function setupWithHelp(): void {
    setupMinimalDOM();
    // index.html ships the section with a static `open` attribute.
    document.body.insertAdjacentHTML(
      'beforeend',
      `<details id="help-section" open>
         <summary>What is this app?</summary>
         <div id="help-section-content">help text</div>
       </details>`
    );
  }

  function help(): HTMLDetailsElement {
    return document.getElementById('help-section') as HTMLDetailsElement;
  }

  it('is open on the very first start (no stored preference)', () => {
    setupWithHelp();
    initUI(createMockCallbacks());
    expect(help().open).toBe(true);
  });

  it('persists a collapse to localStorage when the user closes it', () => {
    setupWithHelp();
    initUI(createMockCallbacks());
    // jsdom does not auto-fire `toggle` on an `open` change — simulate the user.
    help().open = false;
    help().dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem(HELP_COLLAPSED_KEY)).toBe('true');
  });

  it('restores the collapsed state on a fresh start after the user collapsed it', () => {
    localStorage.setItem(HELP_COLLAPSED_KEY, 'true');
    setupWithHelp();
    initUI(createMockCallbacks());
    expect(help().open).toBe(false);
  });

  // The reported expectation: the manual should show ONCE. A returning user
  // (who has launched before but never explicitly collapsed it) should NOT keep
  // getting the full wall of help text on every start — it should default to
  // collapsed once seen, while first-time users still get it open.
  it('collapses by default on a return visit even if the user never collapsed it', () => {
    // Simulate "the user has opened the app before" (help was already seen) but
    // has no explicit collapse preference stored.
    localStorage.setItem(HELP_SEEN_KEY, 'true');
    setupWithHelp();
    initUI(createMockCallbacks());
    expect(help().open).toBe(false);
  });

  // Why this test matters: `initHelpSection` runs synchronously inside `initUI`,
  // which `main.ts` calls unguarded during UI bootstrap. Some environments
  // (private browsing in certain browsers, sandboxed iframes without
  // allow-same-origin, storage disabled by policy) throw a SecurityError /
  // DOMException on ANY `localStorage` access — including reads. Without a guard
  // that throw escapes `initUI` and crashes the entire app at startup. Every
  // other localStorage site in the project (recording-options load/save/reset)
  // already wraps access in try/catch; this pins that the help section degrades
  // the same way (keeps the shipped `open` default instead of crashing).
  it('degrades gracefully when localStorage access throws (private mode / sandboxed iframe)', () => {
    setupWithHelp();
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('localStorage is disabled', 'SecurityError');
      });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('localStorage is disabled', 'SecurityError');
      });
    try {
      expect(() => initUI(createMockCallbacks())).not.toThrow();
      // With no readable preference we keep index.html's shipped default (open).
      expect(help().open).toBe(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  // A user-toggle after init must also survive a throwing localStorage: the
  // `toggle` listener persists the collapse preference, but a write failure
  // (quota, disabled storage) must not propagate out of the DOM event handler.
  it('does not throw from the toggle handler when persisting the preference fails', () => {
    setupWithHelp();
    initUI(createMockCallbacks());
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });
    try {
      help().open = false;
      expect(() => help().dispatchEvent(new Event('toggle'))).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

/**
 * Tests for the unsupported-platform notice (D1, 2026-06-16 user feedback,
 * Finding 1).
 *
 * Why these tests matter: when `immersive-ar` WebXR is unavailable (the common
 * case being iOS, whose browsers do not provide browser AR tracking) the app
 * silently dropped into replay mode — the field tester read this as "the app
 * only works on Chrome on Android" with no in-app explanation. The setup UI is
 * already suppressed by `switchToReplayMode`, but the *why* was hidden too.
 * `showUnsupportedPlatformNotice` surfaces a prominent, plain-language
 * explanation of the cause and the fix (Chrome on Android), while keeping
 * replay available.
 */
describe('showUnsupportedPlatformNotice', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reveals the hidden platform notice', () => {
    document.body.innerHTML =
      '<div id="unsupported-platform-notice" class="hidden"></div>';

    showUnsupportedPlatformNotice();

    const notice = document.getElementById('unsupported-platform-notice')!;
    expect(notice.classList.contains('hidden')).toBe(false);
  });

  it('does not throw when the notice element is absent (defensive)', () => {
    expect(() => showUnsupportedPlatformNotice()).not.toThrow();
  });

  it('the production notice explains the cause and points to Chrome on Android', () => {
    // Guard the actual user-facing copy in index.html so a future edit cannot
    // silently strip the explanation. It must name: the cause (AR tracking the
    // browser lacks, with iOS as the example), the fix (Chrome on Android), and
    // that replay is still available.
    const noticeHtml = extractElementById('unsupported-platform-notice');
    expect(noticeHtml).toMatch(/iOS/i);
    expect(noticeHtml).toMatch(/Chrome/i);
    expect(noticeHtml).toMatch(/Android/i);
    expect(noticeHtml).toMatch(/AR/);
    expect(noticeHtml).toMatch(/replay/i);
  });

  it('the production notice is prominent (not the tiny webxr-warning styling)', () => {
    // D1 asks for a *prominent* explanation, unlike the pre-existing
    // text-xs #webxr-warning line. Assert the banner does not use text-xs and
    // starts hidden (revealed only on unsupported platforms).
    const noticeHtml = extractElementById('unsupported-platform-notice');
    expect(noticeHtml).toContain('hidden');
    expect(noticeHtml).not.toMatch(/class="[^"]*\btext-xs\b/);
  });

  it('index.html keeps the notice inside the setup modal so it shows at startup', () => {
    // The notice must live where the user lands (the setup modal), not buried.
    const full = loadFullIndexHtml();
    expect(full).toContain('id="unsupported-platform-notice"');
  });
});

/**
 * Tests for the in-AR ref-point proximity hint (D3, 2026-06-16 user feedback,
 * Finding 3).
 *
 * Why these tests matter: the dual proximity model (tap to re-observe a nearby
 * known point vs. ➕ to force-create a new one, plus the button relabelling to
 * the nearby point's name) confused the field tester ("sometimes you create new
 * ones, sometimes the name switches to an older one"). The decision (D3) is to
 * KEEP the model but make the state legible: the displayed name is a *location
 * confirmation* ("you're at 'Bench', not its neighbour"). This hint renders that
 * confirmation inline. No name-management UI, no behaviour change.
 */
describe('updateRefPointHint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('confirms the location and the re-observe action when in the same cell as a known point', () => {
    document.body.innerHTML = '<div id="ref-point-hint" class="hidden"></div>';

    updateRefPointHint({ displayName: 'Bench', isNeighborCell: false });

    const hint = document.getElementById('ref-point-hint')!;
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('Bench');
    expect(hint.textContent).toMatch(/re-observe/i);
    // Same cell: no ➕ guidance (the secondary button is hidden in this state).
    expect(hint.textContent).not.toContain('➕');
  });

  it('explains both the re-observe and the ➕ new-point option when in a neighbour cell', () => {
    document.body.innerHTML = '<div id="ref-point-hint" class="hidden"></div>';

    updateRefPointHint({ displayName: 'Bench', isNeighborCell: true });

    const hint = document.getElementById('ref-point-hint')!;
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toContain('Bench');
    expect(hint.textContent).toMatch(/re-observe/i);
    // Neighbour cell: the ➕ force-new option is offered.
    expect(hint.textContent).toContain('➕');
  });

  it('hides the hint when not near any known point', () => {
    document.body.innerHTML =
      "<div id=\"ref-point-hint\">You're at 'Bench'</div>";

    updateRefPointHint(undefined);

    const hint = document.getElementById('ref-point-hint')!;
    expect(hint.classList.contains('hidden')).toBe(true);
    expect(hint.textContent).toBe('');
  });

  it('does not throw when the hint element is absent (defensive)', () => {
    expect(() =>
      updateRefPointHint({ displayName: 'X', isNeighborCell: false })
    ).not.toThrow();
  });

  it('index.html ships the hint element near the recording controls', () => {
    const full = loadFullIndexHtml();
    expect(full).toContain('id="ref-point-hint"');
  });
});

/**
 * Tests for the AbsCompass status row (AbsoluteOrientationSensor Phase 1, plan §5).
 *
 * Why these tests matter: this row is the field tester's only on-device signal
 * that a recording is actually capturing the independent-north sensor before
 * collecting many sessions. It must show a green "ok" when active, a gray
 * "unavailable" with the reason off Chrome Android, and a yellow error — and the
 * element must actually ship in index.html.
 */
describe('AbsCompass status row', () => {
  function setupDOMWithAbsCompass(): void {
    const hud = document.createElement('div');
    hud.innerHTML = `
      <div id="abs-compass-info" class="hidden">
        <span id="abs-compass-status">--</span>
      </div>
    `;
    document.body.appendChild(hud);
  }

  it('shows the live magnetic heading in degrees when active (matches v3 demo)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud.js');
    setAbsCompassStatus({ state: 'active', headingDeg: 123.4 });

    const info = document.getElementById('abs-compass-info')!;
    const status = document.getElementById('abs-compass-status')!;
    expect(info.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toBe('123°');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('falls back to "ok" when active but the phone is level (heading undefined)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud.js');
    setAbsCompassStatus({ state: 'active', headingDeg: null });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('ok');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('falls back to "ok" (not "NaN°") when active but the heading is NaN', async () => {
    // `typeof NaN === 'number'` is true, so a guard on `typeof` alone would
    // render `Math.round(NaN)` → "NaN°". A degenerate quaternion can yield a
    // NaN heading; the row must degrade to "ok" rather than show "NaN°".
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud.js');
    setAbsCompassStatus({ state: 'active', headingDeg: Number.NaN });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('ok');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('shows gray "unavailable" with the reason (iOS/Safari/desktop path)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud.js');
    setAbsCompassStatus({ state: 'unavailable', reason: 'no sensor' });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('unavailable (no sensor)');
    expect(status.classList.contains('text-gray-400')).toBe(true);
  });

  it('shows a yellow error with the reason', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud.js');
    setAbsCompassStatus({ state: 'error', reason: 'NotReadableError' });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toContain('NotReadableError');
    expect(status.classList.contains('text-yellow-400')).toBe(true);
  });

  it('hideAbsCompass hides the row', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus, hideAbsCompass } = await import('./hud.js');
    setAbsCompassStatus({ state: 'active' });
    hideAbsCompass();
    expect(
      document.getElementById('abs-compass-info')!.classList.contains('hidden')
    ).toBe(true);
  });

  it('index.html ships the AbsCompass status element', () => {
    const full = loadFullIndexHtml();
    expect(full).toContain('id="abs-compass-status"');
  });
});
