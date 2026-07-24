import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    a11y: { test: 'todo' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'centered',
  },
  decorators: [
    Story => (
      <div className="min-h-80 min-w-80 bg-wa-app p-6 text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
        <Story />
      </div>
    ),
  ],
}

export default preview
