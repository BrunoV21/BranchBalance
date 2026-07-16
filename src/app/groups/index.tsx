import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function GroupsScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.empty}>
        <Text style={styles.title}>No groups yet</Text>
        <Text style={styles.body}>Your GitHub-backed expense groups will appear here.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fa' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#17201d', fontSize: 22, fontWeight: '700' },
  body: { color: '#68716e', fontSize: 15, marginTop: 8, textAlign: 'center' },
});
