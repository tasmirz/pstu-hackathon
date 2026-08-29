import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tag = body.tag ? `--tag ${body.tag}` : '';
    const only = body.only ? `--only ${body.only}` : '';
    const reset = body.reset ? '--reset' : '';

    const projectRoot = path.resolve(process.cwd(), '..');
    const cmd = `npm run sim -w sim -- --json ${reset} ${tag} ${only}`.trim();

    return new Promise<NextResponse>((resolve) => {
      exec(cmd, { cwd: projectRoot, timeout: 60000 }, (error, stdout, stderr) => {
        let jsonResults: any = null;
        try {
          const lines = stdout.split('\n');
          const jsonStart = lines.findIndex((l) => l.startsWith('{"timestamp":') || l.startsWith('{"summary":') || l.startsWith('['));
          if (jsonStart !== -1) {
            const rawJson = lines.slice(jsonStart).join('\n');
            jsonResults = JSON.parse(rawJson);
          }
        } catch {
          // fallback to stdout parsing
        }

        return resolve(
          NextResponse.json({
            success: !error,
            cmd,
            output: stdout,
            error: stderr || (error ? error.message : null),
            results: jsonResults,
          })
        );
      });
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
