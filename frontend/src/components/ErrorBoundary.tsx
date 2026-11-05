import { Component, type ReactNode } from 'react';
import { Button, Code, Group, Stack, Text, Title } from '@mantine/core';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the pathname) clears the error. */
  resetKey?: string;
}

/** Keeps the shell alive when a page throws while rendering. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Stack gap="md" maw={640} py="xl" role="alert">
        <Title order={1}>Something went wrong</Title>
        <Text c="dimmed">Reload the page. If it keeps happening, send this message to your admin.</Text>
        <Code block>{error.message}</Code>
        <Group>
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
        </Group>
      </Stack>
    );
  }
}
