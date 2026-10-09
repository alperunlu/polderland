import ExpoModulesCore
import GameKit

/// Game Center for Polderland: sign the player in, submit a score to a
/// leaderboard, and show a leaderboard. The game runs in a WebView and reaches
/// this through App.js, which forwards the page's messages here.
public class PolderlandGameCenterModule: Module {
  private let presenter = LeaderboardPresenter()

  public func definition() -> ModuleDefinition {
    Name("PolderlandGameCenter")

    /// Sign in. Resolves true when the local player is authenticated. Game
    /// Center may show its own sign-in sheet; if the player dismisses it, or
    /// Game Center is turned off, this resolves false and the game plays on.
    AsyncFunction("authenticate") { (promise: Promise) in
      DispatchQueue.main.async {
        var settled = false
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
          if let viewController = viewController {
            self?.appContext?.utilities?.currentViewController()?.present(viewController, animated: true)
            return
          }
          if !settled {
            settled = true
            promise.resolve(GKLocalPlayer.local.isAuthenticated)
          }
        }
      }
    }

    Function("isAuthenticated") { () -> Bool in
      GKLocalPlayer.local.isAuthenticated
    }

    /// Submit a score. Game Center keeps each player's best on its own.
    AsyncFunction("submitScore") { (leaderboardId: String, score: Int, promise: Promise) in
      guard GKLocalPlayer.local.isAuthenticated else {
        promise.resolve(false)
        return
      }
      GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local,
                                leaderboardIDs: [leaderboardId]) { error in
        promise.resolve(error == nil)
      }
    }

    /// Present one leaderboard, all-time and global.
    AsyncFunction("showLeaderboard") { (leaderboardId: String) in
      guard let root = self.appContext?.utilities?.currentViewController() else { return }
      let vc = GKGameCenterViewController(leaderboardID: leaderboardId,
                                          playerScope: .global, timeScope: .allTime)
      vc.gameCenterDelegate = self.presenter
      root.present(vc, animated: true)
    }.runOnQueue(.main)
  }
}

/// Dismisses the Game Center sheet when the player closes it.
final class LeaderboardPresenter: NSObject, GKGameCenterControllerDelegate {
  func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
    gameCenterViewController.dismiss(animated: true)
  }
}
