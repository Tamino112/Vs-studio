import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAugmentedEnv, getDotnetBin } from './dotnetService';

const execFileAsync = promisify(execFile);

export interface NuGetPackageSummary {
  id: string;
  version: string;
  versions: string[];
  description: string;
  authors: string;
  totalDownloads: number;
  iconUrl?: string;
  projectUrl?: string;
  verified?: boolean;
}

export async function searchNugetPackages(query: string, take = 25): Promise<NuGetPackageSummary[]> {
  const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${take}&prerelease=false&semVerLevel=2.0.0`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NuGet search failed (${res.status})`);
  }
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      version: string;
      versions?: Array<{ version: string }>;
      description?: string;
      authors?: string[] | string;
      totalDownloads?: number;
      iconUrl?: string;
      projectUrl?: string;
      verified?: boolean;
    }>;
  };
  return (json.data || []).map((pkg) => ({
    id: pkg.id,
    version: pkg.version,
    versions: (pkg.versions || []).map((v) => v.version).reverse(),
    description: pkg.description || '',
    authors: Array.isArray(pkg.authors) ? pkg.authors.join(', ') : pkg.authors || '',
    totalDownloads: pkg.totalDownloads || 0,
    iconUrl: pkg.iconUrl,
    projectUrl: pkg.projectUrl,
    verified: pkg.verified,
  }));
}

export async function installNugetPackage(
  csprojPath: string,
  packageId: string,
  version?: string,
): Promise<{ success: boolean; output: string }> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  const args = ['add', csprojPath, 'package', packageId];
  if (version) args.push('--version', version);

  try {
    const { stdout, stderr } = await execFileAsync(dotnetBin, args, { env });
    return { success: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`.trim(),
    };
  }
}

export async function removeNugetPackage(
  csprojPath: string,
  packageId: string,
): Promise<{ success: boolean; output: string }> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  try {
    const { stdout, stderr } = await execFileAsync(
      dotnetBin,
      ['remove', csprojPath, 'package', packageId],
      { env },
    );
    return { success: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`.trim(),
    };
  }
}
