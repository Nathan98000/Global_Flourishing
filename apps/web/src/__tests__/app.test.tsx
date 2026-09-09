import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { createAppRouter } from '../router'

async function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(<RouterProvider router={router} />)
  await router.load()
}

test('index route renders the Atlas placeholder', async () => {
  await renderAt('/')
  expect(await screen.findByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
  expect(screen.getByText(/Global Flourishing Study/)).toBeInTheDocument()
})

test('methods route renders', async () => {
  await renderAt('/methods')
  expect(await screen.findByRole('heading', { name: 'Methods' })).toBeInTheDocument()
  expect(screen.getByText(/Associations, not causes/)).toBeInTheDocument()
})
