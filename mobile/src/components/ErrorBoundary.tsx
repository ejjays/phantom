import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import tw from '../lib/tw';
import { reportError } from '../lib/crash';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack ?? '' });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={tw`flex-1 items-center justify-center bg-background px-8`}>
        <Text style={tw`mb-2 text-2xl font-sans-bold text-white`}>
          something broke
        </Text>
        <Text
          style={tw`mb-6 text-center font-mono text-sm leading-5 text-slate-400`}
        >
          Phantom hit an unexpected error. your downloads are safe.
        </Text>
        <View
          style={tw`mb-6 w-full rounded-2xl border border-red-400/30 bg-red-400/10 p-4`}
        >
          <Text selectable style={tw`font-mono text-xs text-red-300`}>
            {error.message}
          </Text>
        </View>
        <Pressable
          onPress={this.reset}
          style={tw`rounded-full bg-cyan-500 px-8 py-3`}
        >
          <Text style={tw`font-mono-bold uppercase tracking-wider text-white`}>
            try again
          </Text>
        </Pressable>
      </View>
    );
  }
}
