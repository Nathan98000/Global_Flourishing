// Render a component that uses <Link> without standing up the app's
// whole route tree: a one-route router whose root renders the node.

import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'

export function renderWithRouter(node: ReactNode): RenderResult {
  const rootRoute = createRootRoute({ component: () => <>{node}</> })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router as never} />)
}
