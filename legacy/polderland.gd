extends Node2D
class_name WaterManagementGame

# Game mechanics
var water_amount: float = 0.0
var money: int = 10000
var points: int = 0
var base_water_per_second: float = 2.0
var water_per_second: float = 2.0
var dike_cost: int = 50
var dike_cost_increase: float = 1.8
var dike_level: int = 0
var max_water_capacity: float = 1000.0
var is_game_over: bool = false
var town_generated: bool = false
var dike_data = []  # {tile_pos: Vector2, is_coastal: bool}
var pump_positions = []
var pump_reduction_rate: float = 0.5
var pump_cost: int = 200
var pump_cost_increase: float = 1.1
var canal_positions = []
var canal_cost: int = 150
var water_increase_threshold: float = 100.0
var water_increase_level: int = 0
var canal_income_rate: float = 0.1
var canal_cost_increase: float = 1.3
var min_zoom_level: float = 0.3
var max_zoom_level: float = 1.3
var zoom_speed: float = 0.1

# Music Variables
var music_player = AudioStreamPlayer.new()
var chord_progression = [
	[261.63, 329.63, 392.00],  # C4-E4-G4
	[293.66, 369.99, 440.00],  # D4-F#4-A4
	[329.63, 415.30, 493.88],  # E4-G#4-B4
	[349.23, 440.00, 523.25]   # F4-A4-C5
]
var current_chord = 0
var bpm = 80
var samples_processed = 0
var chord_duration = 4.0

# Win Condition
var water_stable_timer = 0.0
const WIN_CONDITION_TIME = 5.0
var game_won = false

# Tile system
var zoom_level = 0.9
var tile_size = Vector2(120, 60)
var grid_size = Vector2(16, 16)
var tiles = []
var camera_offset = Vector2.ZERO
var coastal_tiles = []

# Texture System
var tile_textures = {
	"ground": [
		Color("#5D4037"), 
		Color("#6D4C41"), 
		Color("#4E342E")
	],
	"coastal": Color("#8D6E63"),
	"canal": Color(0.2, 0.6, 0.8, 0.8)
}

# Visual elements
var water_rect: ColorRect
var rain_particles: GPUParticles2D
var game_over_ui: Panel
var retry_button: Button
var water_label: Label
var money_label: Label
var points_label: Label
var dike_button: Button
var pump_button: Button
var canal_button: Button
var ui_layer: CanvasLayer
var tooltip: Control = null
var emergency_panel: Panel
var building_menu: HBoxContainer
var drag_start_pos = Vector2.ZERO
var camera_move_speed = 10.0
var camera_edge_margin = 50
#date
var current_date = {"day": 1, "month": 1, "year": 2026}
var date_label: Label
var day_timer = 0.0
const SECONDS_PER_DAY = 1.0

# Color palette
var colors: Dictionary = {
	"ground": Color("#5D4037"),
	"water": Color(0.2, 0.4, 0.8, 0.6),
	"building_wall": [Color("#F5F5DC"), Color("#E6D5B8"), Color("#D2B48C")],
	"building_roof": [Color("#C1441C"), Color("#3A2A1A"), Color("#5D4037")],
	"window": Color("#B3E5FC"),
	"door": Color("#5D4037"),
	"dike": Color("#795548"),
	"dike_text": Color("#FFFFFF"),
	"mill": Color("#6D4C41"),
	"mill_roof": Color("#8D6E63"),
	"mill_details": Color("#4E342E"),
	"blade": Color("#FFFFFF"),
	"sky": Color("#87CEEB"),
	"ui_bg": Color(0.1, 0.1, 0.2, 0.7),
	"ui_fg": Color(0.9, 0.9, 1.0),
	"warning": Color("#FF5555"),
	"pump": Color("#4CAF50"),
	"pump_details": Color("#2E7D32"),
	"canal": Color(0.2, 0.6, 0.8, 0.8),
	"coastal": Color("#8D6E63"),
	"tooltip_bg": Color(0.1, 0.1, 0.2, 0.9)
}

func _ready() -> void:
	setup_nodes()
	setup_game()
	generate_town()
	identify_coastal_tiles()
	center_camera()
	setup_hud_layout()
	add_child(music_player)
	var generator = AudioStreamGenerator.new()
	generator.mix_rate = 44100
	generator.buffer_length = 0.1
	music_player.stream = generator
	music_player.volume_db = -12
	music_player.play()
	setup_date_display()
	
func setup_date_display():
	date_label = Label.new()
	date_label.name = "DateLabel"
	date_label.position = Vector2(get_viewport_rect().size.x/2 - 100, 10)
	date_label.size = Vector2(200, 30)
	date_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	date_label.add_theme_font_size_override("font_size", 24)
	date_label.add_theme_color_override("font_color", colors.ui_fg)
	update_date_text()
	ui_layer.add_child(date_label)

func update_date_text():
	date_label.text = "%02d-%02d-%04d" % [current_date.day, current_date.month, current_date.year]

func advance_day():
	current_date.day += 1
	if current_date.day > get_days_in_month(current_date.month, current_date.year):
		current_date.day = 1
		current_date.month += 1
		
		if current_date.month > 12:
			current_date.month = 1
			current_date.year += 1
	
	update_date_text()
	
func get_days_in_month(month: int, year: int) -> int:
	match month:
		2:
			if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0):
				return 29
			return 28
		4, 6, 9, 11:
			return 30
		_:
			return 31
			
func setup_hud_layout() -> void:
	emergency_panel = Panel.new()
	emergency_panel.name = "EmergencyPanel"
	emergency_panel.position = Vector2(
		get_viewport_rect().size.x - 320,
		get_viewport_rect().size.y - 120
	)
	emergency_panel.size = Vector2(300, 100)
	emergency_panel.add_theme_stylebox_override("panel", create_ui_stylebox())
	
	var default_label = Label.new()
	default_label.name = "DefaultMessage"
	default_label.text = "NEWS: New mayor started!"
	default_label.add_theme_font_size_override("font_size", 18)
	default_label.add_theme_color_override("font_color", colors.ui_fg)
	default_label.position = Vector2(20, 20)
	default_label.size = Vector2(260, 60)
	emergency_panel.add_child(default_label)
	
	ui_layer.add_child(emergency_panel)

func center_camera() -> void:
	var map_width = (grid_size.x + grid_size.y) * tile_size.x / 2 * zoom_level
	var map_height = (grid_size.x + grid_size.y) * tile_size.y / 2 * zoom_level
	var target_zoom = min(
		get_viewport_rect().size.x / map_width,
		get_viewport_rect().size.y / map_height
	) * 0.9
	zoom_level = target_zoom
	camera_offset = Vector2(
		(get_viewport_rect().size.x - map_width) / 2,
		(get_viewport_rect().size.y - map_height) / 2 + 50
	)
	queue_redraw()

func setup_nodes() -> void:
	water_rect = ColorRect.new()
	water_rect.name = "WaterRect"
	add_child(water_rect)
	water_rect.z_index = 3
	
	rain_particles = GPUParticles2D.new()
	rain_particles.name = "RainParticles"
	add_child(rain_particles)
	rain_particles.z_index = 4
	
	ui_layer = CanvasLayer.new()
	ui_layer.name = "UI"
	add_child(ui_layer)
	
	water_label = Label.new()
	water_label.name = "WaterLabel"
	water_label.position = Vector2(20, 20)
	water_label.add_theme_font_size_override("font_size", 24)
	water_label.add_theme_color_override("font_color", colors.ui_fg)
	ui_layer.add_child(water_label)
	
	money_label = Label.new()
	money_label.name = "MoneyLabel"
	money_label.position = Vector2(20, 60)
	money_label.add_theme_font_size_override("font_size", 24)
	money_label.add_theme_color_override("font_color", colors.ui_fg)
	ui_layer.add_child(money_label)
	
	points_label = Label.new()
	points_label.name = "PointsLabel"
	points_label.position = Vector2(get_viewport_rect().size.x - 220, 20)
	points_label.size = Vector2(200, 30)
	points_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	points_label.add_theme_font_size_override("font_size", 24)
	points_label.add_theme_color_override("font_color", colors.ui_fg)
	ui_layer.add_child(points_label)
	
	dike_button = Button.new()
	dike_button.name = "DikeButton"
	dike_button.position = Vector2(20, 100)
	dike_button.size = Vector2(300, 50)
	dike_button.add_theme_font_size_override("font_size", 20)
	dike_button.add_theme_color_override("font_color", colors.ui_fg)
	dike_button.add_theme_stylebox_override("normal", create_ui_stylebox())
	dike_button.add_theme_stylebox_override("hover", create_ui_stylebox(1.1))
	dike_button.add_theme_stylebox_override("pressed", create_ui_stylebox(0.95))
	dike_button.pressed.connect(_on_dike_pressed)
	dike_button.mouse_entered.connect(show_tooltip.bind("Build coastal dike to prevent flooding", dike_button.position + Vector2(0, -30)))
	dike_button.mouse_exited.connect(hide_tooltip)
	ui_layer.add_child(dike_button)
	
	pump_button = Button.new()
	pump_button.name = "PumpButton"
	pump_button.position = Vector2(20, 160)
	pump_button.size = Vector2(300, 50)
	pump_button.add_theme_font_size_override("font_size", 20)
	pump_button.add_theme_color_override("font_color", colors.ui_fg)
	pump_button.add_theme_stylebox_override("normal", create_ui_stylebox())
	pump_button.add_theme_stylebox_override("hover", create_ui_stylebox(1.1))
	pump_button.add_theme_stylebox_override("pressed", create_ui_stylebox(0.95))
	pump_button.pressed.connect(_on_pump_pressed)
	pump_button.mouse_entered.connect(show_tooltip.bind("Install pumps to reduce water level", pump_button.position + Vector2(0, -30)))
	pump_button.mouse_exited.connect(hide_tooltip)
	ui_layer.add_child(pump_button)
	
	canal_button = Button.new()
	canal_button.name = "CanalButton"
	canal_button.position = Vector2(20, 220)
	canal_button.size = Vector2(300, 50)
	canal_button.add_theme_font_size_override("font_size", 20)
	canal_button.add_theme_color_override("font_color", colors.ui_fg)
	canal_button.add_theme_stylebox_override("normal", create_ui_stylebox())
	canal_button.add_theme_stylebox_override("hover", create_ui_stylebox(1.1))
	canal_button.add_theme_stylebox_override("pressed", create_ui_stylebox(0.95))
	canal_button.pressed.connect(_on_canal_pressed)
	canal_button.mouse_entered.connect(show_tooltip.bind("Build canals to redirect water and earn income", canal_button.position + Vector2(0, -30)))
	canal_button.mouse_exited.connect(hide_tooltip)
	ui_layer.add_child(canal_button)
	
	game_over_ui = Panel.new()
	game_over_ui.name = "GameOverUI"
	game_over_ui.size = get_viewport_rect().size
	game_over_ui.visible = false
	game_over_ui.add_theme_stylebox_override("panel", create_ui_stylebox(1.0, true))
	ui_layer.add_child(game_over_ui)
	
	retry_button = Button.new()
	retry_button.name = "RetryButton"
	retry_button.text = "TRY AGAIN"
	retry_button.size = Vector2(200, 60)
	retry_button.add_theme_font_size_override("font_size", 24)
	retry_button.add_theme_color_override("font_color", colors.ui_fg)
	retry_button.add_theme_stylebox_override("normal", create_ui_stylebox())
	var center_container = CenterContainer.new()
	center_container.anchor_right = 1.0
	center_container.anchor_bottom = 1.0
	center_container.add_child(retry_button)
	game_over_ui.add_child(center_container)
	retry_button.pressed.connect(_on_retry_pressed)

func setup_game() -> void:
	water_rect.size = Vector2(get_viewport_rect().size.x, 0)
	water_rect.position = Vector2(0, get_viewport_rect().size.y)
	water_rect.color = colors.water
	setup_rain_particles()
	start_rain()
	update_ui()

func setup_rain_particles() -> void:
	var rain_material := ParticleProcessMaterial.new()
	rain_material.scale_min = 1.2
	rain_material.scale_max = 1.8
	rain_material.direction = Vector3(0, 1, 0)
	rain_material.spread = 25
	rain_material.gravity = Vector3(0, 300, 0)
	rain_material.lifetime_randomness = 0.2
	rain_material.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	rain_material.emission_box_extents = Vector3(get_viewport_rect().size.x/2, 5, 0)
	rain_particles.process_material = rain_material
	rain_particles.amount = 80
	rain_particles.lifetime = 1.5
	rain_particles.position = Vector2(get_viewport_rect().size.x/2, -10)

func start_rain() -> void:
	rain_particles.emitting = true

func generate_town() -> void:
	tiles = []
	for x in range(grid_size.x):
		tiles.append([])
		for y in range(grid_size.y):
			tiles[x].append({
				"type": "ground",
				"has_building": false,
				"building_type": "",
				"is_coastal": false,
				"texture_variant": randi() % tile_textures["ground"].size()
			})
	place_buildings()
	place_windmills()
	town_generated = true
	queue_redraw()

func place_buildings() -> void:
	for i in range(10):
		var x = randi() % int(grid_size.x - 4) + 2
		var y = randi() % int(grid_size.y - 4) + 2
		if not tiles[x][y].has_building:
			tiles[x][y].has_building = true
			tiles[x][y].building_type = "house"
			tiles[x][y].texture_variant = randi() % 3

func place_windmills() -> void:
	var mill_positions = [Vector2(2, 2), Vector2(5, 5)]
	for pos in mill_positions:
		if pos.x < grid_size.x and pos.y < grid_size.y:
			tiles[pos.x][pos.y].has_building = true
			tiles[pos.x][pos.y].building_type = "windmill"

func identify_coastal_tiles() -> void:
	coastal_tiles.clear()
	for x in range(grid_size.x):
		for y in range(grid_size.y):
			if not tiles[x][y].is_coastal:
				if x == 0 or x == grid_size.x - 1 or y == 0 or y == grid_size.y - 1:
					tiles[x][y].is_coastal = true
					coastal_tiles.append(Vector2(x, y))
				else:
					for dx in [-1, 0, 1]:
						for dy in [-1, 0, 1]:
							if dx == 0 and dy == 0: continue
							var nx = x + dx
							var ny = y + dy
							if nx >= 0 and ny >= 0 and nx < grid_size.x and ny < grid_size.y:
								if tiles[nx][ny].type == "water":
									tiles[x][y].is_coastal = true
									coastal_tiles.append(Vector2(x, y))
									break

func cart_to_iso(cart: Vector2) -> Vector2:
	return (Vector2(
		(cart.x - cart.y) * tile_size.x / 2,
		(cart.x + cart.y) * tile_size.y / 2
	) * zoom_level) + camera_offset

func _draw() -> void:
	draw_rect(Rect2(0, 0, get_viewport_rect().size.x, get_viewport_rect().size.y), colors.sky)
	
	for y in range(grid_size.y):
		for x in range(grid_size.x):
			var pos = cart_to_iso(Vector2(x, y))
			var tile = tiles[x][y]
			set_z_index((x + y) * 10)
			
			var tile_color = tile_textures["ground"][tile.texture_variant]
			if tile.is_coastal:
				tile_color = tile_textures["coastal"]
			elif Vector2(x, y) in canal_positions:
				tile_color = tile_textures["canal"]
			
			draw_tile(pos, x, y, tile_color)
			
			if tile.has_building:
				if tile.building_type == "house":
					draw_building(pos, x, y)
				elif tile.building_type == "windmill":
					draw_windmill(pos, x, y)
	
	for dike in dike_data:
		draw_dike(dike)
	
	for pump_pos in pump_positions:
		draw_pump(pump_pos)

func draw_tile(pos: Vector2, x: int, y: int, color: Color) -> void:
	var tile_points = PackedVector2Array()
	tile_points.append(pos + Vector2(0, 0))
	tile_points.append(pos + Vector2(tile_size.x/2 * zoom_level, tile_size.y/2 * zoom_level))
	tile_points.append(pos + Vector2(0, tile_size.y * zoom_level))
	tile_points.append(pos + Vector2(-tile_size.x/2 * zoom_level, tile_size.y/2 * zoom_level))
	draw_colored_polygon(tile_points, color)
	draw_polyline(tile_points, Color(0,0,0,0.3), 1.0, true)

func draw_building(pos: Vector2, x: int, y: int) -> void:
	var width = tile_size.x * 0.8 * zoom_level
	var height = tile_size.y * 1.5 * zoom_level
	var color_index = (x + y) % colors.building_wall.size()
	
	var building_points = PackedVector2Array()
	building_points.append(pos + Vector2(-width/2, 0))
	building_points.append(pos + Vector2(width/2, 0))
	building_points.append(pos + Vector2(width/2, -height))
	building_points.append(pos + Vector2(-width/2, -height))
	draw_colored_polygon(building_points, colors.building_wall[color_index])
	
	var roof_points = PackedVector2Array()
	roof_points.append(pos + Vector2(-width/2, -height))
	roof_points.append(pos + Vector2(0, -height * 1.2))
	roof_points.append(pos + Vector2(width/2, -height))
	draw_colored_polygon(roof_points, colors.building_roof[color_index])
	
	draw_rect(Rect2(pos.x - 15 * zoom_level, pos.y - height/2 - 10 * zoom_level, 
				30 * zoom_level, 20 * zoom_level), colors.window)
	draw_rect(Rect2(pos.x - 10 * zoom_level, pos.y - 20 * zoom_level, 
				20 * zoom_level, 20 * zoom_level), colors.door)

func draw_windmill(pos: Vector2, x: int, y: int) -> void:
	var size = (1.0 + (x + y) * 0.1) * zoom_level
	var base_height = 120 * size
	var base_width = 60 * size
	
	var tower_points = PackedVector2Array()
	tower_points.append(pos + Vector2(-base_width/2, 0))
	tower_points.append(pos + Vector2(base_width/2, 0))
	tower_points.append(pos + Vector2(0, -base_height))
	draw_colored_polygon(tower_points, colors.mill)
	
	var roof_points = PackedVector2Array()
	roof_points.append(pos + Vector2(-base_width/2, -base_height))
	roof_points.append(pos + Vector2(0, -base_height - 30 * size))
	roof_points.append(pos + Vector2(base_width/2, -base_height))
	draw_colored_polygon(roof_points, colors.mill_roof)
	
	var angle = Time.get_ticks_msec() / 1000.0
	var hub_pos = pos + Vector2(0, -base_height + 20 * size)
	draw_circle(hub_pos, 8 * size, colors.mill_details)
	
	for i in range(4):
		var blade_angle = angle + i * PI/2
		var end_pos = hub_pos + Vector2(cos(blade_angle), sin(blade_angle)) * 80 * size
		draw_line(hub_pos, end_pos, colors.blade, 4.0 * size)
		var perpendicular = Vector2(-(end_pos - hub_pos).y, (end_pos - hub_pos).x).normalized() * 5 * size
		for j in range(1, 4):
			var detail_pos = hub_pos + (end_pos - hub_pos) * (j * 0.2)
			draw_line(detail_pos + perpendicular, detail_pos - perpendicular, colors.mill_details, 2.0 * size)

func draw_dike(dike_info: Dictionary) -> void:
	var pos = cart_to_iso(dike_info.tile_pos)
	var width = 80 * zoom_level
	var height = 50 * zoom_level
	
	draw_rect(Rect2(pos.x - width/2, pos.y - height, width, height), colors.dike)
	
	var top_points = PackedVector2Array()
	top_points.append(pos + Vector2(-width/2, -height))
	top_points.append(pos + Vector2(0, -height - 20 * zoom_level))
	top_points.append(pos + Vector2(width/2, -height))
	draw_colored_polygon(top_points, Color(colors.dike.r * 0.8, colors.dike.g * 0.8, colors.dike.b * 0.8))
	
	var font = ThemeDB.fallback_font
	var font_size = 20 * zoom_level
	var text_pos = pos + Vector2(-40 * zoom_level, -height/2 - 10 * zoom_level)
	draw_string(font, text_pos, "DIJK", HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, colors.dike_text)

func draw_pump(pump_tile_pos: Vector2) -> void:
	var pos = cart_to_iso(pump_tile_pos)
	var size = 0.8 * zoom_level
	var base_height = 60 * size
	var base_width = 40 * size
	
	var pump_points = PackedVector2Array()
	pump_points.append(pos + Vector2(-base_width/2, 0))
	pump_points.append(pos + Vector2(base_width/2, 0))
	pump_points.append(pos + Vector2(base_width/2, -base_height))
	pump_points.append(pos + Vector2(-base_width/2, -base_height))
	draw_colored_polygon(pump_points, colors.pump)
	
	draw_rect(Rect2(pos.x - 15 * size, pos.y - base_height + 10 * size, 30 * size, 10 * size), colors.pump_details)
	draw_rect(Rect2(pos.x - 5 * size, pos.y - base_height + 20 * size, 10 * size, 20 * size), colors.pump_details)
	draw_circle(pos + Vector2(0, -base_height - 5 * size), 5 * size, colors.water)

func _on_dike_pressed() -> void:
	if money >= dike_cost and not is_game_over and coastal_tiles.size() > 0:
		money -= dike_cost
		points += dike_cost
		dike_level += 1
		
		var coastal_index = randi() % coastal_tiles.size()
		var coastal_pos = coastal_tiles[coastal_index]
		
		dike_data.append({"tile_pos": coastal_pos, "is_coastal": true})
		coastal_tiles.remove_at(coastal_index)
		
		dike_cost = int(dike_cost * dike_cost_increase)
		dike_button.text = "Buy Dike (Cost: %d)" % dike_cost
		update_ui()
		water_effect()
		queue_redraw()

func _on_pump_pressed() -> void:
	if money >= pump_cost and not is_game_over:
		money -= pump_cost
		points += pump_cost
		
		var valid_positions = []
		for x in range(grid_size.x):
			for y in range(grid_size.y):
				if not tiles[x][y].has_building and Vector2(x,y) not in pump_positions:
					valid_positions.append(Vector2(x,y))
		
		if valid_positions.size() > 0:
			var pos_index = randi() % valid_positions.size()
			pump_positions.append(valid_positions[pos_index])
			pump_cost = int(pump_cost * pump_cost_increase)
			pump_button.text = "Buy Pump (Cost: %d)" % pump_cost
		
		update_ui()
		pump_effect()
		queue_redraw()

func _on_canal_pressed() -> void:
	if money >= canal_cost and not is_game_over:
		money -= canal_cost
		points += canal_cost
		
		var valid_positions = []
		if canal_positions.size() == 0:
			for x in range(grid_size.x):
				for y in range(grid_size.y):
					if not tiles[x][y].has_building and not is_position_dike(Vector2(x,y)) and Vector2(x,y) not in canal_positions:
						valid_positions.append(Vector2(x,y))
		else:
			for pos in canal_positions:
				for dx in [-1, 0, 1]:
					for dy in [-1, 0, 1]:
						if dx == 0 and dy == 0: continue
						
						var new_pos = Vector2(pos.x + dx, pos.y + dy)
						if (new_pos.x >= 0 and new_pos.y >= 0 and 
							new_pos.x < grid_size.x and new_pos.y < grid_size.y and
							not tiles[new_pos.x][new_pos.y].has_building and
							not is_position_dike(new_pos) and
							new_pos not in canal_positions):
							
							valid_positions.append(new_pos)
		
		if valid_positions.size() > 0:
			var new_canal_pos = valid_positions[randi() % valid_positions.size()]
			canal_positions.append(new_canal_pos)
			water_amount = max(0, water_amount - 50)
			canal_cost = int(canal_cost * canal_cost_increase)
			update_ui()
			queue_redraw()
		else:
			show_tooltip("No valid adjacent tiles for canal!", canal_button.position + Vector2(0, -30))

func is_position_dike(pos: Vector2) -> bool:
	for dike in dike_data:
		if dike.tile_pos == pos:
			return true
	return false

func _on_retry_pressed() -> void:
	get_tree().reload_current_scene()

func water_effect() -> void:
	var tween = create_tween()
	tween.tween_property(water_rect, "size:y", water_rect.size.y * 0.6, 0.4)\
			.set_ease(Tween.EASE_OUT)\
			.set_trans(Tween.TRANS_BACK)

func pump_effect() -> void:
	var tween = create_tween()
	tween.tween_property(water_rect, "color:a", 0.4, 0.3)
	tween.tween_property(water_rect, "color:a", colors.water.a, 0.3)

func update_water_display() -> void:
	var water_height = (water_amount / max_water_capacity) * get_viewport_rect().size.y
	water_rect.size.y = water_height
	water_rect.position.y = get_viewport_rect().size.y - water_height

func update_ui() -> void:
	water_label.text = "Water: %d/%d" % [int(water_amount), int(max_water_capacity)]
	money_label.text = "Money: %d" % money
	points_label.text = "Points: %d" % points
	dike_button.text = "Build Dike (Cost: %d)" % dike_cost
	dike_button.disabled = money < dike_cost or is_game_over or coastal_tiles.size() == 0
	pump_button.text = "Buy Pump (Cost: %d)" % pump_cost
	pump_button.disabled = money < (200 + dike_level * 50) or is_game_over
	canal_button.text = "Build Canal (Cost: %d)" % canal_cost
	canal_button.disabled = money < canal_cost or is_game_over

func calculate_water_resistance() -> float:
	var total_resistance = 0.0
	for dike in dike_data:
		var screen_pos = cart_to_iso(dike.tile_pos)
		if screen_pos.y > get_viewport_rect().size.y - water_rect.size.y:
			total_resistance += 0.3
	return 1.0 / (1.0 + total_resistance)

func calculate_pump_reduction() -> float:
	return pump_positions.size() * pump_reduction_rate

func calculate_water_increase_level() -> void:
	var new_level = int(water_amount / water_increase_threshold)
	if new_level > water_increase_level:
		water_increase_level = new_level
		water_per_second = base_water_per_second * (1.0 + water_increase_level * 0.2)

func calculate_canal_income(delta: float) -> float:
	var base_income = canal_positions.size() * canal_income_rate * water_amount * delta   
	return min(base_income, 100 * delta)

func win_game():
	game_won = true
	show_win_screen()
	stop_music_gradually()

func show_win_screen():
	var win_panel = Panel.new()
	win_panel.name = "WinPanel"
	win_panel.size = Vector2(400, 200)
	ui_layer.add_child(win_panel)
	
	var viewport_size = get_viewport().get_visible_rect().size
	win_panel.position = viewport_size / 2 - win_panel.size / 2
	
	var style = StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.8, 0.3, 0.9)
	win_panel.add_theme_stylebox_override("panel", style)
	
	var label = Label.new()
	label.text = "YOU WIN!"
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.size = win_panel.size
	win_panel.add_child(label)
	
	var button = Button.new()
	button.text = "Play Again"
	button.position = Vector2(win_panel.size.x/2 - 50, 150)
	button.size = Vector2(100, 40)
	button.pressed.connect(_on_retry_pressed)
	win_panel.add_child(button)

func stop_music_gradually():
	var tween = create_tween()
	tween.tween_property(music_player, "volume_db", -80.0, 2.0)
	tween.tween_callback(music_player.stop)

func create_ui_stylebox(scale: float = 1.0, full_size: bool = false) -> StyleBoxFlat:
	var style = StyleBoxFlat.new()
	style.bg_color = colors.ui_bg
	style.border_color = colors.ui_fg
	style.border_width_left = 2
	style.border_width_right = 2
	style.border_width_top = 2
	style.border_width_bottom = 2
	style.corner_radius_top_left = 8 * scale
	style.corner_radius_top_right = 8 * scale
	style.corner_radius_bottom_right = 8 * scale
	style.corner_radius_bottom_left = 8 * scale
	style.shadow_color = Color(0, 0, 0, 0.3)
	style.shadow_size = 4 * scale
	if full_size:
		style.content_margin_left = 20
		style.content_margin_right = 20
		style.content_margin_top = 20
		style.content_margin_bottom = 20
	return style

func show_tooltip(text: String, position: Vector2) -> void:
	if tooltip:
		tooltip.queue_free()
	
	tooltip = Panel.new()
	tooltip.name = "Tooltip"
	tooltip.position = position
	tooltip.add_theme_stylebox_override("panel", create_ui_stylebox(0.7))
	
	var label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", 14)
	label.add_theme_color_override("font_color", colors.ui_fg)
	label.position = Vector2(5, 5)
	
	tooltip.add_child(label)
	ui_layer.add_child(tooltip)
	tooltip.size = label.size + Vector2(10, 10)

func hide_tooltip() -> void:
	if tooltip:
		tooltip.queue_free()
		tooltip = null

func update_emergency_message(message: String, is_urgent: bool = false):
	var label = emergency_panel.get_node("DefaultMessage") as Label
	label.text = message
	if is_urgent:
		label.add_theme_color_override("font_color", colors.warning)
	else:
		label.add_theme_color_override("font_color", colors.ui_fg)

func adjust_rain_intensity() -> void:
	var intensity: float = 1.0 + (water_amount / max_water_capacity) * 3.0 + dike_level * 0.6
	rain_particles.amount = int(40 + intensity * 120)
	var rain_material: ParticleProcessMaterial = rain_particles.process_material as ParticleProcessMaterial
	rain_material.scale_min = 1.2 + intensity * 0.3
	rain_material.scale_max = 1.8 + intensity * 0.3
	rain_material.gravity = Vector3(0, 300 + intensity * 50, 0)

func end_game() -> void:
	is_game_over = true
	game_over_ui.visible = true
	rain_particles.emitting = false
	var tween = create_tween()
	tween.tween_property(water_rect, "color:a", 0.9, 0.8)
	tween.parallel().tween_property(water_rect, "color:s", 1.5, 0.8)

func _process(delta: float) -> void:
	var playback: AudioStreamGeneratorPlayback = music_player.get_stream_playback()
	var frames_available = playback.get_frames_available()
	
	day_timer += delta
	if day_timer >= SECONDS_PER_DAY:
		day_timer = 0.0
		advance_day()
		
	if not game_won and water_amount <= 1:
		water_stable_timer += delta
		if water_stable_timer >= WIN_CONDITION_TIME:
			win_game()
	if water_amount > 1:
		water_stable_timer = 0.0
				
	if is_game_over: return


	
	if frames_available > 0:
		var samples_per_chord = int(chord_duration * 44100)
		
		for i in range(frames_available):            
			var t = float(samples_processed) / 44100
			var chord_pos = float(samples_processed % samples_per_chord) / samples_per_chord
			
			if samples_processed % samples_per_chord == 0:
				current_chord = (current_chord + 1) % chord_progression.size()
			var sample = 0.0
			for freq in chord_progression[current_chord]:
				sample += sin(t * freq * TAU) * 0.08 * (0.5 + 0.5 * sin(t * 0.3))
				
			sample *= smoothstep(0.0, 0.5, min(chord_pos, 1.0 - chord_pos))
			playback.push_frame(Vector2(sample, sample))
			samples_processed += 1
			
			if t >= 180.0:
				samples_processed = 0

	var move_input = Vector2.ZERO
	if Input.is_key_pressed(KEY_RIGHT) or Input.is_key_pressed(KEY_D):
		move_input.x -= 1
	if Input.is_key_pressed(KEY_LEFT) or Input.is_key_pressed(KEY_A):
		move_input.x += 1
	if Input.is_key_pressed(KEY_DOWN) or Input.is_key_pressed(KEY_S):
		move_input.y -= 1
	if Input.is_key_pressed(KEY_UP) or Input.is_key_pressed(KEY_W):
		move_input.y += 1

	var mouse_pos = get_global_mouse_position()
	if mouse_pos.x < camera_edge_margin:
		move_input.x += 1
	elif mouse_pos.x > get_viewport_rect().size.x - camera_edge_margin:
		move_input.x -= 1
	if mouse_pos.y < camera_edge_margin:
		move_input.y += 1
	elif mouse_pos.y > get_viewport_rect().size.y - camera_edge_margin:
		move_input.y -= 1
		
	if move_input != Vector2.ZERO:
		camera_offset += move_input.normalized() * camera_move_speed
		queue_redraw()
		
	money += calculate_canal_income(delta)
	calculate_water_increase_level()
	var resistance = calculate_water_resistance()
	var pump_reduction = calculate_pump_reduction()
	water_amount += (water_per_second * resistance - pump_reduction) * delta
	water_amount = clamp(water_amount, 0, max_water_capacity)
	update_water_display()
	adjust_rain_intensity()
	update_ui()
	queue_redraw()
	
	if water_amount >= max_water_capacity:
		end_game()

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_level = min(zoom_level + zoom_speed, max_zoom_level)
			queue_redraw()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_level = max(zoom_level - zoom_speed, min_zoom_level)
			queue_redraw()
		elif event.button_index == MOUSE_BUTTON_LEFT and not is_click_on_ui(event.position):
			money += (dike_data.size() + 1)
			update_ui()
			
	if event is InputEventMouseMotion:
		if tooltip and not is_click_on_ui(event.position):
			tooltip.position = event.position + Vector2(20, 20)

func is_click_on_ui(pos: Vector2) -> bool:
	return (dike_button.get_global_rect().has_point(pos) or 
			pump_button.get_global_rect().has_point(pos) or
			canal_button.get_global_rect().has_point(pos) or
			retry_button.get_global_rect().has_point(pos))
