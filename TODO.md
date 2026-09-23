# Open TODOs, issues and ideas

## Future work / ideas

### Local offline AI context and better database
- local memory first approach using sqlite
- look at https://github.com/anaslimem/CortexaDB for ideas
	- also search for similar ideas in the web
- json project file gets big fast and cannot handle concurrent writes
- the ai assistant needs a possibility to fit best case the whole mind map in the context so it can correctly categorize new information and to determine is information is new or already present in the map
	- i think a hirarchical approach would be fitting
	- like:	
		- get new information
		- look at existing categories
		- look where it's fitting
		- get all titles of the nodes of that category
		- look again where it's fitting
		- and so on
		- problem: what if the information gets categorized differently than last time? worst case information duplication happens and linking gets messed up. very bad.
		- also cross-references between topics cannot be done that way
	- maybe the git repo has a better solution for that and can directly be used in the nova project

## TODO
- clicking on the project info label in the graph panel should select the root node and open it in the inspector