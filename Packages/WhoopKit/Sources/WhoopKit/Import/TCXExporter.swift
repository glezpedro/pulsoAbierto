import Foundation

/// Builds a Garmin TCX file with the strap heart rate so a workout (e.g. a Strong session or an
/// auto-detected activity) can be uploaded to Strava with its HR curve.
public enum TCXExporter {

    /// Strava `data_type=tcx` sport names: Running, Biking, Other.
    public static func make(start: Date, end: Date, sport: String = "Other", samples: [StrapSample],
                            calories: Double, notes: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let duration = max(1, end.timeIntervalSince(start))
        let hrs = samples.filter { $0.bpm > 0 && $0.date >= start && $0.date <= end }.sorted { $0.ts < $1.ts }
        let avg = hrs.isEmpty ? 0 : hrs.map { Int($0.bpm) }.reduce(0, +) / hrs.count
        let mx = hrs.map { Int($0.bpm) }.max() ?? 0
        // one trackpoint every 5 s keeps the file small
        var points = ""
        var lastTs = -1_000_000
        for s in hrs where s.ts - lastTs >= 5 {
            lastTs = s.ts
            points += """
                      <Trackpoint><Time>\(iso.string(from: s.date))</Time><HeartRateBpm><Value>\(s.bpm)</Value></HeartRateBpm></Trackpoint>

            """
        }
        let escapedNotes = notes.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
          <Activities>
            <Activity Sport="\(sport)">
              <Id>\(iso.string(from: start))</Id>
              <Lap StartTime="\(iso.string(from: start))">
                <TotalTimeSeconds>\(Int(duration))</TotalTimeSeconds>
                <DistanceMeters>0</DistanceMeters>
                <Calories>\(Int(calories))</Calories>
                <AverageHeartRateBpm><Value>\(avg)</Value></AverageHeartRateBpm>
                <MaximumHeartRateBpm><Value>\(mx)</Value></MaximumHeartRateBpm>
                <Intensity>Active</Intensity>
                <TriggerMethod>Manual</TriggerMethod>
                <Track>
        \(points)        </Track>
              </Lap>
              <Notes>\(escapedNotes)</Notes>
            </Activity>
          </Activities>
        </TrainingCenterDatabase>
        """
    }
}
