import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { CameraManagerEngine } from '../../../src/camera-manager/engine';
import { FrigateCamera } from '../../../src/camera-manager/frigate/camera';
import { getPTZInfo } from '../../../src/camera-manager/frigate/requests';
import {
  FrigateEventChange,
  FrigateEventChangeTriggerResponse,
  FrigateEventChangeType,
} from '../../../src/camera-manager/frigate/types';
import { CameraTriggerEventType } from '../../../src/config/types';
import { EntityRegistryManager } from '../../../src/utils/ha/entity-registry';
import { Entity } from '../../../src/utils/ha/entity-registry/types';
import {
  callHASubscribeMessageHandler,
  createCameraConfig,
  createHASS,
  createRegistryEntity,
} from '../../test-utils';

vi.mock('../../../src/camera-manager/frigate/requests');

const createFrigateEventChangeTrigger = (
  type: FrigateEventChangeType,
  before: FrigateEventChange,
  after: FrigateEventChange,
): FrigateEventChangeTriggerResponse => {
  return {
    variables: {
      trigger: {
        payload_json: {
          before: before,
          after: after,
          type: type,
        },
      },
    },
  };
};

describe('FrigateCamera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPTZInfo).mockResolvedValue({});
  });

  describe('should initialize config', () => {
    describe('should detect camera name', () => {
      it('without a camera_entity', async () => {
        const config = createCameraConfig();
        const camera = new FrigateCamera(config, mock<CameraManagerEngine>());
        const beforeConfig = { ...config };

        await camera.initialize(createHASS(), mock<EntityRegistryManager>());

        expect(beforeConfig).toEqual(camera.getConfig());
      });

      it('with a missing camera_entity', async () => {
        const camera = new FrigateCamera(
          createCameraConfig({
            camera_entity: 'camera.not_here',
          }),
          mock<CameraManagerEngine>(),
        );
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockRejectedValue(null);

        expect(
          async () => await camera.initialize(createHASS(), entityRegistryManager),
        ).rejects.toThrowError(/Could not find camera entity/);
      });

      it('with a valid camera_entity', async () => {
        const camera = new FrigateCamera(
          createCameraConfig({
            camera_entity: 'camera.front_door',
          }),
          mock<CameraManagerEngine>(),
        );
        const entityRegistryManager = mock<EntityRegistryManager>();
        const entity = createRegistryEntity({
          unique_id: '8c4e19d258359e82bc0cf9d47b021c46:camera:fnt_dr',
          platform: 'frigate',
        });
        entityRegistryManager.getEntity.mockResolvedValue(entity);

        await camera.initialize(createHASS(), entityRegistryManager);

        expect(camera.getConfig().frigate.camera_name).toBe('fnt_dr');
      });

      it('with a camera_entity without camera_name match', async () => {
        const camera = new FrigateCamera(
          createCameraConfig({
            camera_entity: 'camera.front_door',
          }),
          mock<CameraManagerEngine>(),
        );
        const entityRegistryManager = mock<EntityRegistryManager>();
        const entity = createRegistryEntity({
          unique_id: '8c4e19d258359e82bc0cf9d47b021c46:WRONG:fnt_dr',
          platform: 'frigate',
        });
        entityRegistryManager.getEntity.mockResolvedValue(entity);

        await camera.initialize(createHASS(), entityRegistryManager);

        expect(camera.getConfig().frigate.camera_name).toBeUndefined();
      });

      it('with a camera_entity without platform match', async () => {
        const camera = new FrigateCamera(
          createCameraConfig({
            camera_entity: 'camera.front_door',
          }),
          mock<CameraManagerEngine>(),
        );
        const entityRegistryManager = mock<EntityRegistryManager>();
        const entity = createRegistryEntity({
          unique_id: '8c4e19d258359e82bc0cf9d47b021c46:camera:fnt_dr',
          platform: 'something_else',
        });
        entityRegistryManager.getEntity.mockResolvedValue(entity);

        await camera.initialize(createHASS(), entityRegistryManager);

        expect(camera.getConfig().frigate.camera_name).toBeUndefined();
      });
    });
  });

  describe('should detect capabilities', () => {
    const nonBirdseyeBaseCapabilities = {
      canFavoriteEvents: true,
      canFavoriteRecordings: true,
      canSeek: true,
      supportsClips: true,
      supportsSnapshots: true,
      supportsRecordings: true,
      supportsTimeline: true,
    };

    it('basic non-birdseye', async () => {
      const camera = new FrigateCamera(
        createCameraConfig(),
        mock<CameraManagerEngine>(),
      );

      await camera.initialize(createHASS(), mock<EntityRegistryManager>());

      expect(camera.getCapabilities()).toEqual(nonBirdseyeBaseCapabilities);
    });

    it('basic birdseye', async () => {
      const camera = new FrigateCamera(
        createCameraConfig({
          frigate: {
            camera_name: 'birdseye',
          },
        }),
        mock<CameraManagerEngine>(),
      );

      await camera.initialize(createHASS(), mock<EntityRegistryManager>());

      expect(camera.getCapabilities()).toEqual({
        ...nonBirdseyeBaseCapabilities,
        canFavoriteEvents: false,
        canFavoriteRecordings: false,
        supportsClips: false,
        supportsSnapshots: false,
        supportsRecordings: false,
        supportsTimeline: false,
      });
    });

    describe('with ptz', () => {
      it('when getPTZInfo call fails', async () => {
        const consoleSpy = vi.spyOn(global.console, 'warn').mockReturnValue(undefined);

        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
          }),
          mock<CameraManagerEngine>(),
        );
        vi.mocked(getPTZInfo).mockRejectedValue(new Error());
        await camera.initialize(createHASS(), mock<EntityRegistryManager>());

        expect(camera.getCapabilities()).toEqual({
          ...nonBirdseyeBaseCapabilities,
        });
        expect(consoleSpy).toBeCalled();
      });

      it('when getPTZInfo call succeeds with continuous motion', async () => {
        vi.spyOn(global.console, 'warn').mockReturnValue(undefined);

        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
          }),
          mock<CameraManagerEngine>(),
        );
        vi.mocked(getPTZInfo).mockResolvedValue({
          features: ['pt', 'zoom'],
          name: 'front_door',
          presets: ['preset01'],
        });
        await camera.initialize(createHASS(), mock<EntityRegistryManager>());

        expect(camera.getCapabilities()).toEqual({
          ...nonBirdseyeBaseCapabilities,
          ptz: {
            panTilt: ['continuous'],
            zoom: ['continuous'],
            presets: ['preset01'],
          },
        });
      });

      it('when getPTZInfo call succeeds with relative motion', async () => {
        vi.spyOn(global.console, 'warn').mockReturnValue(undefined);

        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
          }),
          mock<CameraManagerEngine>(),
        );
        vi.mocked(getPTZInfo).mockResolvedValue({
          features: ['pt-r', 'zoom-r'],
          name: 'front_door',
          presets: ['preset01'],
        });
        await camera.initialize(createHASS(), mock<EntityRegistryManager>());

        expect(camera.getCapabilities()).toEqual({
          ...nonBirdseyeBaseCapabilities,
          ptz: {
            panTilt: ['relative'],
            zoom: ['relative'],
            presets: ['preset01'],
          },
        });
      });
    });
  });

  describe('should handle events', () => {
    it('should subscribe', async () => {
      const camera = new FrigateCamera(
        createCameraConfig({
          frigate: {
            client_id: 'CLIENT_ID',
            camera_name: 'CAMERA',
          },
        }),
        mock<CameraManagerEngine>(),
      );
      const hass = createHASS();

      await camera.initialize(hass, mock<EntityRegistryManager>());

      expect(hass.connection.subscribeMessage).toBeCalledWith(expect.anything(), {
        type: 'subscribe_trigger',
        trigger: {
          platform: 'mqtt',
          topic: `CLIENT_ID/events`,
          payload: 'CAMERA',
          value_template: '{{ value_json.after.camera }}',
        },
      });
    });

    it('should not subscribe with no trigger events', async () => {
      const camera = new FrigateCamera(
        createCameraConfig({
          frigate: {
            client_id: 'CLIENT_ID',
            camera_name: 'CAMERA',
          },
          triggers: {
            events: [],
          },
        }),
        mock<CameraManagerEngine>(),
      );
      const hass = createHASS();

      await camera.initialize(hass, mock<EntityRegistryManager>());

      expect(hass.connection.subscribeMessage).not.toBeCalled();
    });

    it('should not subscribe with no camera name', async () => {
      const camera = new FrigateCamera(
        createCameraConfig({
          frigate: {
            client_id: 'CLIENT_ID',
          },
        }),
        mock<CameraManagerEngine>(),
      );
      const hass = createHASS();

      await camera.initialize(hass, mock<EntityRegistryManager>());

      expect(hass.connection.subscribeMessage).not.toBeCalled();
    });

    it('should unsubscribe on destroy', async () => {
      const camera = new FrigateCamera(
        createCameraConfig({
          frigate: { camera_name: 'front_door' },
        }),
        mock<CameraManagerEngine>(),
      );
      const hass = createHASS();
      const unsubscribeCallback = vi.fn();
      vi.mocked(hass.connection.subscribeMessage).mockResolvedValue(unsubscribeCallback);

      await camera.initialize(hass, mock<EntityRegistryManager>());
      expect(unsubscribeCallback).not.toBeCalled();

      await camera.destroy();
      expect(unsubscribeCallback).toBeCalled();
    });

    describe('should call handler correctly', () => {
      it('with malformed Frigate event', async () => {
        const consoleSpy = vi.spyOn(global.console, 'warn').mockReturnValue(undefined);

        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: { camera_name: 'front_door' },
          }),
          mock<CameraManagerEngine>(),
        );

        const hass = createHASS();
        await camera.initialize(hass, mock<EntityRegistryManager>());

        callHASubscribeMessageHandler(hass, 'GARBAGE');

        expect(consoleSpy).toBeCalledWith(
          'Ignoring unparseable Frigate event',
          'GARBAGE',
        );
      });

      it('with wrong camera', async () => {
        const eventCallback = vi.fn();
        const camera = new FrigateCamera(
          createCameraConfig({
            id: 'CAMERA_1',
            frigate: {
              camera_name: 'camera.front_door',
            },
          }),
          mock<CameraManagerEngine>(),
          {
            eventCallback: eventCallback,
          },
        );

        const hass = createHASS();
        await camera.initialize(hass, mock<EntityRegistryManager>());

        callHASubscribeMessageHandler(
          hass,
          createFrigateEventChangeTrigger(
            'new',
            {
              camera: 'camera.back_door',
              snapshot: null,
              has_clip: false,
              has_snapshot: false,
              label: 'person',
              current_zones: [],
            },
            {
              camera: 'camera.back_door',
              snapshot: null,
              has_clip: false,
              has_snapshot: true,
              label: 'person',
              current_zones: [],
            },
          ),
        );

        expect(eventCallback).not.toBeCalled();
      });

      describe('should handle event type correctly', () => {
        it.each([
          [
            ['events' as const, 'snapshots' as const, 'clips' as const],
            false,
            false,
            true,
          ],
          [
            ['events' as const, 'snapshots' as const, 'clips' as const],
            false,
            true,
            true,
          ],
          [
            ['events' as const, 'snapshots' as const, 'clips' as const],
            true,
            false,
            true,
          ],
          [
            ['events' as const, 'snapshots' as const, 'clips' as const],
            true,
            true,
            true,
          ],

          [['events' as const, 'snapshots' as const], false, false, true],
          [['events' as const, 'snapshots' as const], false, true, true],
          [['events' as const, 'snapshots' as const], true, false, true],
          [['events' as const, 'snapshots' as const], true, true, true],

          [['events' as const, 'clips' as const], false, false, true],
          [['events' as const, 'clips' as const], false, true, true],
          [['events' as const, 'clips' as const], true, false, true],
          [['events' as const, 'clips' as const], true, true, true],

          [['events' as const], false, false, true],
          [['events' as const], false, true, true],
          [['events' as const], true, false, true],
          [['events' as const], true, true, true],

          [['snapshots' as const, 'clips' as const], false, false, false],
          [['snapshots' as const, 'clips' as const], false, true, true],
          [['snapshots' as const, 'clips' as const], true, false, true],
          [['snapshots' as const, 'clips' as const], true, true, true],

          [['snapshots' as const], false, false, false],
          [['snapshots' as const], false, true, false],
          [['snapshots' as const], true, false, true],
          [['snapshots' as const], true, true, true],

          [['clips' as const], false, false, false],
          [['clips' as const], false, true, true],
          [['clips' as const], true, false, false],
          [['clips' as const], true, true, true],
        ])(
          'with events %s when snapshot %s and clip %s',
          async (
            events: CameraTriggerEventType[],
            hasSnapshot: boolean,
            hasClip: boolean,
            call: boolean,
          ) => {
            const eventCallback = vi.fn();
            const camera = new FrigateCamera(
              createCameraConfig({
                id: 'CAMERA_1',
                frigate: {
                  camera_name: 'camera.front_door',
                },
                triggers: {
                  events: events,
                },
              }),
              mock<CameraManagerEngine>(),
              {
                eventCallback: eventCallback,
              },
            );

            const hass = createHASS();
            await camera.initialize(hass, mock<EntityRegistryManager>());

            callHASubscribeMessageHandler(
              hass,
              createFrigateEventChangeTrigger(
                'new',
                {
                  camera: 'camera.front_door',
                  snapshot: null,
                  has_clip: false,
                  has_snapshot: false,
                  label: 'person',
                  current_zones: [],
                },
                {
                  camera: 'camera.front_door',
                  snapshot: null,
                  has_clip: hasClip,
                  has_snapshot: hasSnapshot,
                  label: 'person',
                  current_zones: [],
                },
              ),
            );

            if (call) {
              expect(eventCallback).toBeCalledWith({
                type: 'new',
                cameraID: 'CAMERA_1',
                clip: hasClip && events.includes('clips'),
                snapshot: hasSnapshot && events.includes('snapshots'),
                fidelity: 'high',
              });
            } else {
              expect(eventCallback).not.toBeCalled();
            }
          },
        );
      });

      describe('should handle zones correctly', () => {
        it.each([
          ['has no zone', [], false],
          ['has mismatched zone', ['fence'], false],
          ['has matching zone', ['front_steps'], true],
        ])('%s', async (_name: string, zones: string[], call: boolean) => {
          const eventCallback = vi.fn();
          const camera = new FrigateCamera(
            createCameraConfig({
              id: 'CAMERA_1',
              frigate: {
                camera_name: 'camera.front_door',
                zones: ['front_steps'],
              },
            }),
            mock<CameraManagerEngine>(),
            {
              eventCallback: eventCallback,
            },
          );

          const hass = createHASS();
          await camera.initialize(hass, mock<EntityRegistryManager>());

          callHASubscribeMessageHandler(
            hass,
            createFrigateEventChangeTrigger(
              'new',
              {
                camera: 'camera.front_door',
                snapshot: null,
                has_clip: false,
                has_snapshot: false,
                label: 'person',
                current_zones: [],
              },
              {
                camera: 'camera.front_door',
                snapshot: null,
                has_clip: false,
                has_snapshot: true,
                label: 'person',
                current_zones: zones,
              },
            ),
          );

          expect(eventCallback).toHaveBeenCalledTimes(call ? 1 : 0);
        });
      });

      describe('should handle labels correctly', () => {
        it.each([
          ['has mismatched label', 'car', false],
          ['has matching label', 'person', true],
        ])('%s', async (_name: string, label: string, call: boolean) => {
          const eventCallback = vi.fn();
          const camera = new FrigateCamera(
            createCameraConfig({
              id: 'CAMERA_1',
              frigate: {
                camera_name: 'camera.front_door',
                labels: ['person'],
              },
            }),
            mock<CameraManagerEngine>(),
            {
              eventCallback: eventCallback,
            },
          );

          const hass = createHASS();
          await camera.initialize(hass, mock<EntityRegistryManager>());

          callHASubscribeMessageHandler(
            hass,
            createFrigateEventChangeTrigger(
              'new',
              {
                camera: 'camera.front_door',
                snapshot: null,
                has_clip: false,
                has_snapshot: false,
                // Even new events appear to have the event label in the
                // 'before' dictionary.
                label: label,
                current_zones: [],
              },
              {
                camera: 'camera.front_door',
                snapshot: null,
                has_clip: false,
                has_snapshot: true,
                label: label,
                current_zones: [],
              },
            ),
          );

          expect(eventCallback).toHaveBeenCalledTimes(call ? 1 : 0);
        });
      });
    });
  });

  describe('should handle triggers', () => {
    const cameraEntity: Partial<Entity> = {
      config_entry_id: 'config_entry_id',
    };

    const occupancySensorEntityAll: Partial<Entity> = {
      config_entry_id: 'config_entry_id',
      disabled_by: null,
      entity_id: 'binary_sensor.foo',
      unique_id: '8c4e19d258359e82bc0cf9d47b021c46:occupancy_sensor:front_door_all',
    };

    const motionSensorEntity: Partial<Entity> = {
      config_entry_id: 'config_entry_id',
      disabled_by: null,
      entity_id: 'binary_sensor.foo',
      unique_id: '8c4e19d258359e82bc0cf9d47b021c46:motion_sensor:front_door',
    };

    describe('should detect motion sensor', () => {
      it('without a camera name', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(motionSensorEntity),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            triggers: {
              motion: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual([]);
      });

      it('with camera entity and name', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(motionSensorEntity),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            camera_entity: 'camera.front_door',
            frigate: {
              camera_name: 'front_door',
            },
            triggers: {
              motion: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual(['binary_sensor.foo']);
      });

      it('with matching entity', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(motionSensorEntity),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
            triggers: {
              motion: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual(['binary_sensor.foo']);
      });

      it('without matching entity', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
            triggers: {
              motion: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual([]);
      });
    });

    describe('should detect occupancy sensor', () => {
      it('without a camera name', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(occupancySensorEntityAll),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual([]);
      });

      it('without a camera name but with occupancy trigger', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(occupancySensorEntityAll),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual([]);
      });

      it('with matching entity', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity(occupancySensorEntityAll),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual(['binary_sensor.foo']);
      });

      it('without matching entity', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
            },
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual([]);
      });

      it('with zones', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity({
            ...occupancySensorEntityAll,
            unique_id: '8c4e19d258359e82bc0cf9d47b021c46:occupancy_sensor:zone_all',
          }),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
              zones: ['zone'],
            },
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual(['binary_sensor.foo']);
      });

      it('with labels', async () => {
        const entityRegistryManager = mock<EntityRegistryManager>();
        entityRegistryManager.getEntity.mockResolvedValue(
          createRegistryEntity(cameraEntity),
        );
        entityRegistryManager.getMatchingEntities.mockResolvedValue([
          createRegistryEntity({
            ...occupancySensorEntityAll,
            unique_id:
              '8c4e19d258359e82bc0cf9d47b021c46:occupancy_sensor:front_door_car',
          }),
        ]);
        const camera = new FrigateCamera(
          createCameraConfig({
            frigate: {
              camera_name: 'front_door',
              labels: ['car'],
            },
            triggers: {
              occupancy: true,
            },
          }),
          mock<CameraManagerEngine>(),
        );
        const hass = createHASS();
        await camera.initialize(hass, entityRegistryManager);

        expect(camera.getConfig().triggers.entities).toEqual(['binary_sensor.foo']);
      });
    });

    it('should filter entities with correct function', async () => {
      const entityRegistryManager = mock<EntityRegistryManager>();
      entityRegistryManager.getEntity.mockResolvedValue(
        createRegistryEntity(cameraEntity),
      );
      entityRegistryManager.getMatchingEntities.mockResolvedValue([
        createRegistryEntity({
          ...occupancySensorEntityAll,
        }),
      ]);
      const camera = new FrigateCamera(
        createCameraConfig({
          camera_entity: 'camera.foo',
          triggers: {
            occupancy: true,
          },
        }),
        mock<CameraManagerEngine>(),
      );
      const hass = createHASS();
      await camera.initialize(hass, entityRegistryManager);

      const filterFunc = entityRegistryManager.getMatchingEntities.mock.calls[0][1];

      expect(
        filterFunc(
          createRegistryEntity({
            config_entry_id: cameraEntity.config_entry_id,
            disabled_by: '',
            entity_id: 'binary_sensor.foo',
          }),
        ),
      ).toBeTruthy();

      expect(
        filterFunc(
          createRegistryEntity({
            config_entry_id: cameraEntity.config_entry_id,
            disabled_by: 'user',
            entity_id: 'binary_sensor.foo',
          }),
        ),
      ).toBeFalsy();

      expect(
        filterFunc(
          createRegistryEntity({
            config_entry_id: cameraEntity.config_entry_id,
            disabled_by: '',
            entity_id: 'camera.is_not_a_binary_sensor',
          }),
        ),
      ).toBeFalsy();

      expect(
        filterFunc(
          createRegistryEntity({
            config_entry_id: 'not_a_matching_config_entry_id',
            disabled_by: '',
            entity_id: 'binary_sensor.foo',
          }),
        ),
      ).toBeFalsy();
    });
  });
});