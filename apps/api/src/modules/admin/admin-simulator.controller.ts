import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * `POST /admin/simulator/run` — SIMULATOR.md §5 "Serve it": runs the scenario
 * simulator (sim/, a ts-node CLI against the running stack) and returns the
 * JSON board, so the demo can be launched from a button on the admin UI
 * instead of a terminal. Guards: admin role only.
 *
 * This is a thin shell over `npm run sim -w sim -- --json` (same command the
 * operator runs by hand). It streams the full report; the frontend renders
 * per-group pass/fail counts, the conservation summary, and failing ids.
 */
@Controller('admin/simulator')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSimulatorController {
  @Post('run')
  @HttpCode(200)
  run(@Query('tag') tag?: string, @Query('only') only?: string, @Query('reset') reset?: string): Promise<any> {
    const args = ['run', 'sim', '-w', 'sim', '--', '--json'];
    if (reset === 'true') args.push('--reset');
    if (tag) args.push('--tag', tag);
    if (only) args.push('--only', only);

    const root = this.repoRoot();

    return new Promise((resolve) => {
      execFile(
        'npm',
        args,
        { cwd: root, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const results = this.parseResults(root);
          const summary = results
            ? {
                total: results.reduce((n: number, g: any) => n + g.outcomes.length, 0),
                passed: results.reduce(
                  (n: number, g: any) => n + g.outcomes.filter((o: any) => o.pass).length,
                  0,
                ),
                failed: results.reduce(
                  (n: number, g: any) => n + g.outcomes.filter((o: any) => !o.pass).length,
                  0,
                ),
                groups: results.map((g: any) => ({
                  group: g.group,
                  passed: g.outcomes.filter((o: any) => o.pass).length,
                  total: g.outcomes.length,
                  failed: g.outcomes.filter((o: any) => !o.pass).map((o: any) => o.id),
                })),
              }
            : null;

          resolve({
            success: !error && summary !== null,
            summary,
            results,
            raw: stdout,
            error: error ? stderr || error.message : null,
          });
        },
      );
    });
  }

  /** Find the repo root (dir containing package.json with a `sim` workspace). */
  private repoRoot(): string {
    let dir = path.resolve(__dirname, '..', '..', '..', '..'); // dist/modules/admin -> repo root
    for (let i = 0; i < 4; i += 1) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      dir = path.dirname(dir);
    }
    return process.cwd();
  }

  /** sim/run.ts --json writes sim-results.json next to run.ts. */
  private parseResults(root: string): any[] | null {
    const candidates = [
      path.join(root, 'sim', 'sim-results.json'),
      path.join(root, 'sim', 'dist', 'sim-results.json'),
      path.join(os.tmpdir(), 'sim-results.json'),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        /* try next */
      }
    }
    return null;
  }
}