Pod::Spec.new do |s|
  s.name           = 'PolderlandGameCenter'
  s.version        = '1.0.0'
  s.summary        = 'Game Center sign-in and leaderboards for Polderland'
  s.description    = 'A local Expo module wrapping GameKit: authenticate, submit a score, show a leaderboard.'
  s.author         = 'Polderland'
  s.homepage       = 'https://github.com/alperunlu/polderland'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'GameKit'

  s.source_files = '**/*.{h,m,swift}'
end
