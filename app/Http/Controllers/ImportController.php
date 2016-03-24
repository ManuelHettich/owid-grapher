<?php namespace App\Http\Controllers;

use App\Datasource;
use App\Dataset;
use App\DatasetCategory;
use App\DatasetSubcategory;
use App\DatasetTag;
use App\LinkDatasetsTags;
use App\VariableType;
use App\InputFile;
use App\Variable;
use App\Time;
use App\TimeType;
use App\DataValue;
use App\EntityIsoName;
use App\Entity;
use App\Setting;

use App\Http\Requests;
use App\Http\Controllers\Controller;

use Illuminate\Http\Request;

use DB;
use App\Commands\ImportCommand;
use Carbon\Carbon;

class ImportController extends Controller {

	/**
	 * Display a listing of the resource.
	 *
	 * @return Response
	 */
	public function index()
	{	

		$datasets = Dataset::all();
		$datasources = Datasource::all();
		$variables = Variable::all();
		$categories = DatasetCategory::all();
		$subcategories = DatasetSubcategory::all();
		$varTypes = VariableType::all();
		$sourceTemplate = Setting::where( 'meta_name', 'sourceTemplate' )->first();

		$data = [
			'datasets' => $datasets,
			'datasources' => $datasources,
			'variables' => $variables,
			'categories' => $categories,
			'subcategories' => $subcategories,
			'varTypes' => $varTypes,
			'sourceTemplate' => $sourceTemplate
		];	

		return view( 'import.index' )->with( 'data', $data );
	}

	/**
	 * Import a collection of variables
	 */
	public function variables(Request $request) {
		$input = $request->all();

		return DB::transaction(function() use ($input) {
			// First, we create the dataset object itself
			$dataset = $input['dataset'];
			$entities = $input['entities'];
			$years = $input['years'];
			$variables = $input['variables'];

			if (isset($dataset['sourceId']))
				$sourceId = $dataset['sourceId'];
			else {
				$source = $input['source'];
	
				$sourceProps = [
					'name' => $source['name'],
					'description' => $source['description']
				];

				$sourceId = Datasource::create($sourceProps)->id;
			}

			if (isset($dataset['id']))
				$datasetId = $dataset['id'];			
			else {
				$datasetProps = [
					'name' => $dataset['name'],
					'description' => $dataset['description'],					
					'fk_dst_cat_id' => $dataset['categoryId'],
					'fk_dst_subcat_id' => $dataset['subcategoryId'],
					'fk_dsr_id' => $sourceId
				];

				$datasetId = Dataset::create($datasetProps)->id;
			}

			// Now map the entity names we've been given to ids, and
			// create any new ones that aren't in the database
			$entityNames = array_unique($entities);

			$existingEntities = DB::table('entities')
				->select('id', 'name', 'code')
				->whereIn('code', $entityNames)
				->orWhere(function($query) use ($entityNames) {
					$query->whereIn('name', $entityNames);
				})->get();

			$entityNameToId = [];

			foreach ($existingEntities as $entity) {
				$entityNameToId[$entity->code] = $entity->id;
				$entityNameToId[$entity->name] = $entity->id;
			}

			$newEntities = [];
			foreach ($entityNames as $name) {
				if (isset($entityNameToId[$name])) continue;
				$newEntities[] = [ 'name' => $name, 'fk_ent_t_id' => 5 ];
			}

			if (!empty($newEntities)) {
				DB::table('entities')->insert($newEntities);
				$lastId = DB::getPdo()->lastInsertId();
				$firstId = $lastId - (sizeof($newEntities) - 1);
				for ($id = $firstId; $id <= $lastId; $id++) {
					$name = $newEntities[$id-$firstId]['name'];
					$entityNameToId[$name] = $id;
				}
			}

			// Now we feed in our set of variables and associated data
			foreach ($variables as $variable) {
				$values = $variable['values'];

				$newVariable = [
					'name' => $variable['name'],
					'description' => $variable['description'],
					'unit' => $variable['unit'],
					'fk_var_type_id' => $variable['typeId'],
					'fk_dst_id' => $datasetId,
					'fk_dsr_id' => $sourceId,
					'uploaded_by' => \Auth::user()->name, 
					'uploaded_at' => Carbon::now()
				];

				$varId = DB::table('variables')->insertGetId($newVariable);

				$newDataValues = [];
				for ($i = 0; $i < sizeof($years); $i++) {
					$newDataValues[] = [
						'fk_var_id' => $varId,
						'fk_ent_id' => $entityNameToId[$entities[$i]],
						'year' => $years[$i],
						'value' => $values[$i],
					];
				}

				DB::table('data_values')->insert($newDataValues);
			}

			return [ 'datasetId' => $datasetId ];
		});
	}

	public function hasValue($value) {

		return ( !empty( $value ) || $value === "0" || $value === 0 )? true: false;

	}

	public function inputfile(Request $request) {

		try {
			
			$rawData = ( $request->has( 'rawData' ) )? $request->get( 'rawData' ): '';
			$userId = ( $request->has( 'userId' ) )? $request->get( 'userId' ): '';

			$inputFileData = [ 'raw_data' => $rawData, 'fk_user_id' => $userId ];
			$inputFile = InputFile::create( $inputFileData ); 
			$inputFileDataId = $inputFile->id;
			return [ 'success' => true, 'data' => [ 'inputFileId' => $inputFileDataId ] ];

		} catch( Exception $e ) {

			return ['success' => false];
		
		}
	}
}
