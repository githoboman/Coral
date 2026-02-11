
import { Construction } from "lucide-react";

export default function OnchainAnalysis() {
   return (
      <div className="min-h-screen text-white p-8 max-w-7xl mx-auto flex flex-col items-center justify-center space-y-6">
         <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Construction className="text-[#B7FC0D] w-12 h-12" />
         </div>
         <h1 className="text-4xl font-bold text-center">Analytics Coming Soon</h1>
         <p className="text-white/40 text-center max-w-md">
            We are building powerful on-chain analytics to help you track your performance. Stay tuned!
         </p>
      </div>
   );
}
