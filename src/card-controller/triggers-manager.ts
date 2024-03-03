import isEqual from 'lodash-es/isEqual';
import orderBy from 'lodash-es/orderBy';
import throttle from 'lodash-es/throttle';
import { CameraEvent } from '../camera-manager/types';
import { Timer } from '../utils/timer';
import { CardTriggersAPI } from './types';

export class TriggersManager {
  protected _api: CardTriggersAPI;

  protected _triggeredCameras: Map<string, Date> = new Map();
  protected _triggeredCameraTimers: Map<string, Timer> = new Map();

  protected _throttledTriggerAction = throttle(this._triggerAction.bind(this), 1000, {
    trailing: true,
  });

  constructor(api: CardTriggersAPI) {
    this._api = api;
  }

  public getTriggeredCameraIDs(): Set<string> {
    return new Set(this._triggeredCameras.keys());
  }

  public isTriggered(): boolean {
    return !!this._triggeredCameras.size;
  }

  public getMostRecentlyTriggeredCameraID(): string | null {
    const sorted = orderBy(
      [...this._triggeredCameras.entries()],
      (entry) => entry[1].getTime(),
      'desc',
    );
    return sorted.length ? sorted[0][0] : null;
  }

  public handleCameraEvent(ev: CameraEvent): void {
    const triggersConfig = this._api.getConfigManager().getConfig()?.view.triggers;
    const selectedCameraID = this._api.getViewManager().getView()?.camera;

    if (!triggersConfig || !selectedCameraID) {
      return;
    }

    const dependentCameraIDs = this._api
      .getCameraManager()
      .getStore()
      .getAllDependentCameras(selectedCameraID);

    if (triggersConfig.filter_selected_camera && !dependentCameraIDs.has(ev.cameraID)) {
      return;
    }

    if (ev.type === 'end') {
      this._startUntriggerTimer(ev.cameraID);
      return;
    }

    this._triggeredCameras.set(ev.cameraID, new Date());
    this._setConditionStateIfNecessary();
    this._throttledTriggerAction(ev);
  }

  protected _hasAllowableInteractionStateForAction(): boolean {
    const triggersConfig = this._api.getConfigManager().getConfig()?.view.triggers;
    const hasInteraction = this._api.getInteractionManager().hasInteraction();

    return (
      !!triggersConfig &&
      (triggersConfig.actions.interaction_mode === 'all' ||
        (triggersConfig.actions.interaction_mode === 'active' && hasInteraction) ||
        (triggersConfig.actions.interaction_mode === 'inactive' && !hasInteraction))
    );
  }

  protected _triggerAction(ev: CameraEvent): void {
    const triggerAction = this._api.getConfigManager().getConfig()?.view.triggers
      .actions.trigger;
    const defaultView = this._api.getConfigManager().getConfig()?.view.default;

    // If this is a high-fidelity event where we are certain about new media,
    // don't take action unless it's to change to live (Frigate engine may pump
    // out events where there's no new media to show).
    if (
      ev.fidelity === 'high' &&
      !ev.snapshot &&
      !ev.clip &&
      !(
        triggerAction === 'live' ||
        (triggerAction === 'default' && defaultView === 'live')
      )
    ) {
      return;
    }

    if (this._hasAllowableInteractionStateForAction()) {
      if (triggerAction === 'live') {
        this._api.getViewManager().setViewByParameters({
          viewName: 'live',
          cameraID: ev.cameraID,
        });
      } else if (triggerAction === 'default') {
        this._api.getViewManager().setViewDefault({
          cameraID: ev.cameraID,
        });
      } else if (ev.fidelity === 'high' && triggerAction === 'media') {
        this._api.getViewManager().setViewByParameters({
          viewName: ev.clip ? 'clip' : 'snapshot',
          cameraID: ev.cameraID,
        });
      }
    }

    // Must update master element to add border pulsing to live view.
    this._api.getCardElementManager().update();
  }

  protected _setConditionStateIfNecessary(): void {
    const triggeredCameraIDs = new Set(this._triggeredCameras.keys());
    const triggeredState = triggeredCameraIDs.size ? triggeredCameraIDs : undefined;

    if (
      !isEqual(triggeredState, this._api.getConditionsManager().getState().triggered)
    ) {
      this._api.getConditionsManager().setState({
        triggered: triggeredState,
      });
    }
  }

  protected _untriggerAction(cameraID: string): void {
    const action = this._api.getConfigManager().getConfig()?.view.triggers
      .actions.untrigger;

    if (action === 'default' && this._hasAllowableInteractionStateForAction()) {
      this._api.getViewManager().setViewDefault();
    }
    this._triggeredCameras.delete(cameraID);
    this._deleteTimer(cameraID);
    this._setConditionStateIfNecessary();

    // Must update master element to remove border pulsing from live view.
    this._api.getCardElementManager().update();
  }

  protected _startUntriggerTimer(cameraID: string): void {
    this._deleteTimer(cameraID);

    const timer = new Timer();
    this._triggeredCameraTimers.set(cameraID, timer);
    timer.start(
      /* istanbul ignore next: the case of config being null here cannot be
         reached, as there's no way to have the untrigger call happen without
         a config. -- @preserve */
      this._api.getConfigManager().getConfig()?.view.triggers.untrigger_seconds ?? 0,
      () => {
        this._untriggerAction(cameraID);
      },
    );
  }

  protected _deleteTimer(cameraID: string): void {
    this._triggeredCameraTimers.get(cameraID)?.stop();
    this._triggeredCameraTimers.delete(cameraID);
  }
}
