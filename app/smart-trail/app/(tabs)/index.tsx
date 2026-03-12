import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function GenerateScreen() {
  return (
    <SafeAreaView className="flex-1 bg-stone-950">
      <View className="flex-1 items-center justify-center">
        <Text className="text-white text-2xl font-bold">Generate</Text>
      </View>
    </SafeAreaView>
  );
}
