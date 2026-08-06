import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap children in a ScrollView (default). Set false for screens that manage their own scrolling (FlatList etc). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * The app's single screen shell: white background, top safe area,
 * optional ScrollView with a consistently-tinted RefreshControl,
 * and uniform bottom breathing room.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ['top'],
  style,
  contentStyle,
}: ScreenProps) {
  return (
    <View style={[styles.container, style]}>
      <SafeAreaView style={styles.safeArea} edges={edges}>
        {scroll ? (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={contentStyle}
            showsVerticalScrollIndicator={false}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={!!refreshing}
                  onRefresh={onRefresh}
                  tintColor={Colors.primary}
                />
              ) : undefined
            }
          >
            {children}
            <View style={styles.bottomSpacer} />
          </ScrollView>
        ) : (
          children
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  bottomSpacer: {
    height: 40,
  },
});
