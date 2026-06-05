/**
 * Optional terminal dashboard entry point.
 * Requires `ink` and `react` (dev/demo); not loaded by the core limiter.
 */
export {
  Dashboard,
  runPacedWork,
  runWithDashboard,
  type RunDashboardOptions,
  type RunPacedWorkOptions,
} from './tui/index'
