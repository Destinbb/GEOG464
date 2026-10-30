# Montreal Bike Lanes

## The five sentences

1. **Problem:** People commuting by bike in Montréal may not know what cycling infrastructure is available across the city, making it harder to understand the potential route options.
2. **Audience:** This map is for cyclists in Montreal who want to explore the city's bicycle network by area and facility type.
3. **Core action:** Toggle the protected and not-identified as protected layers, then click a segment to inspect its type, area, protection status, year-round status, and recorded length.
4. **Boundary:** This iteration includes facilities marked as within the City of Montreal and does not provide routing, surface-condition, closure, or safety assessments.
5. **Data:** The map uses Montreal Open Data's continuously updated "Reseau cyclable" GeoJSON, read and narrowed in the project notebook to city records with usable line geometry and required descriptive fields. :https://www.donneesquebec.ca/recherche/dataset/vmtl-pistes-cyclables/resource/0dc6612a-be66-406b-b2d9-59c9e1c65ebf 
6. ## Lab 5 data: 
the pavement layer uses ([Indicateurs de condition des chaussées du réseau routier]), published by the City of Montréal ([https://donnees.montreal.ca/dataset/condition-chaussees-reseau-routier#additional-info]), licensed under Creative Commons Attribution 4.0 International. Accessed October 23, 2026. I joined the pavement PCI condition catergory, score and survey date to bike-network GeoJSON using ID_TRC, and only included matched records in the pavement overlay (5,245 street segments). These ratings describe surveyed street segments but may not represent the bike-lane surface itself.

## AFTER Demo
At my demo I felt like my site desciption could have been a bit more descriptive into what you can actully do with the wesbite. 
After adding my second data layer, I feel like I really have to work on the core action of my website and add more usability features so a real user could actually plan a route based on their prefered parameters.  
## My neighbours 5 second answers: 
"This map is about the Montreal bicycle network. It maps different bike lanes based on whether they are physically protected from cars or not. It always maps the pavement condition of each route based on its Pavement Condition Index or PCI. Blue represents the network's protected routes while dark red represents the network's unprotected routes. For the pavement layer, the darkest colours represent the poorest pavement condition while the lightest represent the best" --- Thanks Lukas


## Run the MVP

1. Open the `TermProj` folder in VS Code.
2. Open `notebooks/TermProject.ipynb` and run every cell from top to bottom. It reads the raw GeoJSON, reports exclusions, writes `bike_lanes_clean_english.geojson`, and finishes with count, geometry-extent, geometry-type, and property checks.
3. Right-click `site/index.html` and choose **Open with Live Server**. The page fetches the notebook output from `../data/bike_lanes_clean_english.geojson`
4. Use the map layer checkboxes to show or hide protected lanes. Click a line for its attributes.

## How AI was used - Guided (blue) lane
How AI was used
I used GitHub Copilot with gpt-6-luna to help load and clean GeoJSON data from Données Québec's open-data portal. I filtered the data to include only features where VILLE_MTL = Oui, removed features with missing geometry or required fields, counted exclusions, and translated selected property keys from French to English. I also used the agent to separate protected and unprotected bike routes. I reviewed the filtered data to verify that routes were within Montréal, the translations preserved the original meaning, and segments were correctly classified.

# B5:
