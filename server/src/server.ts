import pathway from '../../config/pathway.json';
import { state, summarize } from './rules';
import { createStore } from './store';
import type { Changes, Config, Entry } from './types';

const MAX_BATCH = 500;
/** A clinician can date an enrollment to a visit up to two weeks back, never forward. */
const MAX_VISIT_AGE_MS = 14 * 86_400_000;
const ENTRIES: Entry[] = ['watch_event', 'history', 'clinician'];

/** Spike auth: the member id rides in a header. The real app sends a session token. */
const memberOf = (req: Request) => req.headers.get('x-member-id');
const unauthorized = () => Response.json({ error: 'missing x-member-id' }, { status: 401 });

/** `clock` is an input like any other: the e2e test walks a member through a week with it. */
export function serve(port: number, config = pathway as Config, clock = () => new Date()) {
  const store = createStore(config);

  const view = (id: string) => {
    const m = store.member(id);
    const summary = summarize([...m.readings.values()], config);
    return {
      state: state(
        { enrolledAt: m.enrollment?.at, reviewedAt: m.reviewedAt, lastReadingAt: m.lastReadingAt },
        summary,
        clock(),
        config,
      ),
      entry: m.enrollment?.entry ?? null,
      enrolledAt: m.enrollment?.at ?? null,
      summary,
    };
  };

  return Bun.serve({
    port,
    routes: {
      '/v1/health/config': { GET: () => Response.json(config) },

      '/v1/bp-pathway': {
        GET: (req) => {
          const id = memberOf(req);
          return id ? Response.json(view(id)) : unauthorized();
        },
      },

      '/v1/bp-pathway/enroll': {
        POST: async (req) => {
          const id = memberOf(req);
          if (!id) return unauthorized();
          const { entry } = (await req.json()) as { entry: Entry };
          if (!ENTRIES.includes(entry)) return Response.json({ error: 'entry' }, { status: 400 });
          store.enroll(id, entry, clock());
          return Response.json(view(id), { status: 201 });
        },
      },

      /** One page from the device. 2xx means the app may advance its anchor. */
      '/v1/health/changes': {
        POST: async (req) => {
          const id = memberOf(req);
          if (!id) return unauthorized();
          const changes = (await req.json()) as Changes;
          const readings = changes.readings ?? [];
          const tombstones = changes.tombstones ?? [];
          if (readings.length + tombstones.length > MAX_BATCH) {
            return Response.json({ error: `max ${MAX_BATCH} per page` }, { status: 413 });
          }
          const result = store.apply(id, { readings, tombstones }, clock());
          if (!result) return Response.json({ error: 'not_enrolled' }, { status: 409 });
          return Response.json(result);
        },
      },

      '/v1/care/tasks': { GET: () => Response.json(store.tasks()) },

      '/v1/care/members/:id': { GET: (req) => Response.json(view(req.params.id)) },

      /**
       * Entry C: a clinician enrolls the member during a visit, dated to that visit. Consent was
       * given in the room, so readings from then on count.
       */
      '/v1/care/members/:id/enroll': {
        POST: async (req) => {
          const { at } = (await req.json()) as { at?: string };
          const now = clock();
          const visit = at ? new Date(at) : now;
          if (
            Number.isNaN(visit.getTime()) ||
            visit > now ||
            now.getTime() - visit.getTime() > MAX_VISIT_AGE_MS
          ) {
            return Response.json({ error: 'at' }, { status: 400 });
          }
          store.enroll(req.params.id, 'clinician', visit);
          return Response.json(view(req.params.id), { status: 201 });
        },
      },

      '/v1/care/members/:id/review': {
        POST: (req) => {
          store.review(req.params.id, clock());
          return Response.json(view(req.params.id));
        },
      },
    },
    fetch: () => Response.json({ error: 'not found' }, { status: 404 }),
  });
}

if (import.meta.main) {
  const server = serve(Number(process.env.PORT ?? 3100));
  console.log(`bp-pathway listening on ${server.url}`);
}
